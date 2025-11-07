document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const cameraButton = document.getElementById("cycleCamera");
  const nextModelButton = document.getElementById("loadNextModel");
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

  const modelFiles = [
    "Option1.glb",
    "Option2.glb",
    "Option3.glb",
    "Option4.glb",
  ]
    .filter((name) => name.toLowerCase().endsWith(".glb"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  if (!modelFiles.length) {
    console.error("No GLB models found in the Models directory.");
    nextModelButton.textContent = "No models found";
    nextModelButton.disabled = true;
    engine.dispose();
    return;
  }

  const createScene = async () => {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color3(0.04, 0.04, 0.07);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.exposure = 1.15;
    scene.environmentIntensity = 1.0;

    const camera = new BABYLON.ArcRotateCamera(
      "mainCamera",
      BABYLON.Tools.ToRadians(140),
      BABYLON.Tools.ToRadians(65),
      15,
      BABYLON.Vector3.Zero(),
      scene
    );
    camera.attachControl(canvas, true);
    camera.useAutoRotationBehavior = false;
    camera.inertia = 0;
    camera.panningInertia = 0;
    camera.wheelDeltaPercentage = 0.01;
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 200;

    const environmentTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(
      "https://assets.babylonjs.com/environments/environmentSpecular.env",
      scene
    );
    scene.environmentTexture = environmentTexture;

    const environment = scene.createDefaultEnvironment({
      createSkybox: true,
      createGround: false,
      skyboxSize: 250,
      groundSize: 200,
      enableGroundMirror: false,
    });

    if (environment?.skybox?.material) {
      environment.skybox.material.microSurface = 0.6;
      environment.skybox.material.backFaceCulling = false;
    }

    if (environment?.ground) {
      const groundMat = new BABYLON.PBRMaterial("groundMat", scene);
      groundMat.albedoColor = new BABYLON.Color3(0.12, 0.14, 0.18);
      groundMat.roughness = 0.9;
      groundMat.metallic = 0.0;
      environment.ground.material = groundMat;
      environment.ground.receiveShadows = true;
    }

    const sun = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(-0.4, -1, -0.6), scene);
    sun.position = new BABYLON.Vector3(60, 120, 80);
    sun.intensity = 1.6;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 500;

    const fillLight = new BABYLON.HemisphericLight("fillLight", new BABYLON.Vector3(0, 1, 0), scene);
    fillLight.intensity = 0.55;

    const rootUrl = "Models/";

    let currentImport = null;
    let currentModelIndex = 0;
    let isLoadingModel = false;
    let cameraConfigs = [];
    let currentCameraConfigIndex = 0;
    let isAnimatingCamera = false;
    let beamMaterial = null;

    const cameraAnimationFrames = 90;
    const cameraEase = new BABYLON.CubicEase();
    cameraEase.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);

    const shadowGenerator = new BABYLON.ShadowGenerator(2048, sun);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 16;
    shadowGenerator.blurScale = 2;
    shadowGenerator.bias = 0.00015;

    const layerKeys = [
      "layerName",
      "LayerName",
      "layer",
      "Layer",
      "layerID",
      "LayerID",
      "Layer Id",
      "Layer id",
      "NX_Layer",
    ];

    const extractLayerFromMetadata = (metadata) => {
      if (!metadata) {
        return null;
      }
      for (const key of layerKeys) {
        if (metadata[key]) {
          return metadata[key];
        }
      }
      if (metadata.properties) {
        for (const key of layerKeys) {
          if (metadata.properties[key]) {
            return metadata.properties[key];
          }
        }
      }
      if (metadata.extras) {
        for (const key of layerKeys) {
          if (metadata.extras[key]) {
            return metadata.extras[key];
          }
        }
      }
      if (Array.isArray(metadata.layers) && metadata.layers.length) {
        return metadata.layers[0];
      }
      return null;
    };

    const findLayerName = (mesh) => {
      let current = mesh;
      while (current) {
        const layer = extractLayerFromMetadata(current.metadata);
        if (layer) {
          return layer;
        }
        current = current.parent;
      }
      if (mesh.name) {
        const matched = mesh.name.match(/layer[:\-\s_]*([A-Za-z0-9]+)$/i);
        if (matched) {
          return matched[1];
        }
        const parts = mesh.name.split(/[:|_\-]/);
        if (parts.length > 1) {
          return parts[0];
        }
      }
      return null;
    };

    const isRenderableMesh = (mesh) => {
      if (!mesh || typeof mesh.getClassName !== "function") {
        return false;
      }
      const className = mesh.getClassName().toLowerCase();
      if (!className.includes("mesh")) {
        return false;
      }
      if (typeof mesh.getTotalVertices === "function") {
        return mesh.getTotalVertices() > 0;
      }
      return true;
    };

    const clearShadowCasters = () => {
      const casters = shadowGenerator.getShadowCasters?.();
      if (!Array.isArray(casters)) {
        return;
      }
      casters.slice().forEach((mesh) => {
        shadowGenerator.removeShadowCaster(mesh);
      });
    };

    const disposeCurrentImport = () => {
      if (!currentImport) {
        return;
      }
      currentImport.animationGroups?.forEach((group) => group.dispose());
      currentImport.meshes?.forEach((mesh) => {
        if (mesh && !mesh.isDisposed()) {
          mesh.dispose(false, true);
        }
      });
      currentImport.skeletons?.forEach((skeleton) => skeleton.dispose());
      currentImport = null;
    };

    const updateCameraButtonState = () => {
      if (!cameraButton) {
        return;
      }
      cameraButton.textContent = "Views";
      if (!cameraConfigs.length || isAnimatingCamera) {
        cameraButton.disabled = true;
        return;
      }
      cameraButton.disabled = false;
    };

    const resetCameraConfigs = () => {
      cameraConfigs = [];
      currentCameraConfigIndex = 0;
      isAnimatingCamera = false;
      updateCameraButtonState();
    };

    const getBeamMaterial = () => {
      if (!beamMaterial) {
        beamMaterial = new BABYLON.PBRMaterial("beamMaterial", scene);
        beamMaterial.albedoColor = new BABYLON.Color3(1, 0, 0);
      }
      return beamMaterial;
    };

    const applyBeamMaterialToNode = () => {
      const targetNode =
        typeof scene.getTransformNodeByName === "function"
          ? scene.getTransformNodeByName("400_BEAM")
          : null;
      
      // const resolvedNode = targetNode || (typeof scene.getNodeByName === "function" ? scene.getNodeByName("400_BEAM") : null);
      // if (!resolvedNode || typeof resolvedNode.getChildMeshes !== "function") {
      //   return;
      // }
      const resolvedNode =scene.getTransformNodeByName("400_BEAM");

      console.log(targetNode);

      const meshesToUpdate = resolvedNode.getChildMeshes(true);

      console.log(`Found ${meshesToUpdate.length} meshes under 400_BEAM.`);

      if (!Array.isArray(meshesToUpdate) || !meshesToUpdate.length) {
        return;
      }



      const material = getBeamMaterial();
      meshesToUpdate.forEach((mesh) => {
        if (mesh instanceof BABYLON.AbstractMesh && !(mesh instanceof BABYLON.InstancedMesh)) {
          mesh.material = material;
        }
      });
    };

    const applyCameraConfig = (config) => {
      if (!config) {
        return;
      }
      camera.alpha = config.alpha;
      camera.beta = config.beta;
      camera.radius = config.radius;
      camera.setTarget(config.target.clone());
      camera.inertialAlphaOffset = 0;
      camera.inertialBetaOffset = 0;
      camera.inertialRadiusOffset = 0;
      camera.inertialPanningX = 0;
      camera.inertialPanningY = 0;
      if (config.label) {
        console.log(`Camera: ${config.label}`);
      } else {
        console.log("Camera: (unnamed)");
      }
    };

    const animateCameraTo = (config) => {
      if (!config) {
        return;
      }
      isAnimatingCamera = true;
      updateCameraButtonState();

      const animations = [];

      animations.push(
        BABYLON.Animation.CreateAndStartAnimation(
          "alphaAnim",
          camera,
          "alpha",
          60,
          cameraAnimationFrames,
          camera.alpha,
          config.alpha,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
          cameraEase
        )
      );

      animations.push(
        BABYLON.Animation.CreateAndStartAnimation(
          "betaAnim",
          camera,
          "beta",
          60,
          cameraAnimationFrames,
          camera.beta,
          config.beta,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
          cameraEase
        )
      );

      animations.push(
        BABYLON.Animation.CreateAndStartAnimation(
          "radiusAnim",
          camera,
          "radius",
          60,
          cameraAnimationFrames,
          camera.radius,
          config.radius,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
          cameraEase
        )
      );

      const targetAnimatable = BABYLON.Animation.CreateAndStartAnimation(
        "targetAnim",
        camera,
        "target",
        60,
        cameraAnimationFrames,
        camera.target.clone(),
        config.target.clone(),
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
        cameraEase
      );

      const finalize = () => {
        animations.forEach((animatable) => {
          if (animatable) {
            animatable.stop();
          }
        });
        if (targetAnimatable) {
          targetAnimatable.stop();
        }
        applyCameraConfig(config);
        isAnimatingCamera = false;
        updateCameraButtonState();
      };

      if (targetAnimatable) {
        targetAnimatable.onAnimationEndObservable.addOnce(() => {
          finalize();
        });
      } else {
        finalize();
      }
    };

    const computeBoundsForMeshes = (meshes) => {
      if (!meshes.length) {
        return null;
      }
      let hasBounds = false;
      let minVector = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
      let maxVector = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

      meshes.forEach((mesh) => {
        if (typeof mesh.getHierarchyBoundingVectors !== "function") {
          return;
        }
        const { min, max } = mesh.getHierarchyBoundingVectors(true);
        if (!min || !max) {
          return;
        }
        minVector = BABYLON.Vector3.Minimize(minVector, min);
        maxVector = BABYLON.Vector3.Maximize(maxVector, max);
        hasBounds = true;
      });

      if (!hasBounds) {
        return null;
      }

      const center = minVector.add(maxVector).scale(0.5);
      const extent = maxVector.subtract(minVector);
      const radius = Math.max(extent.length() * 0.6, 8);
      const height = Math.max(extent.y, 1);

      return { center, radius, height };
    };

    const setupCameraConfigs = (bounds) => {
      if (!bounds) {
        resetCameraConfigs();
        return;
      }

      //const baseTarget = bounds.center.add(new BABYLON.Vector3(0, bounds.height * 0.1, 0));
      const baseTarget = new BABYLON.Vector3(0, 0, 0);
      cameraConfigs = [
        {
          label: "Perspective",
          alpha: BABYLON.Tools.ToRadians(-60),
          beta: BABYLON.Tools.ToRadians(70),
          radius: bounds.radius * 1.4,
          target: baseTarget.clone(),
        },
        {
          label: "Front",
          alpha: BABYLON.Tools.ToRadians(0),
          beta: BABYLON.Tools.ToRadians(70),
          radius: bounds.radius * 1.2,
          target: baseTarget.clone(),
        },
        {
          label: "Side",
          alpha: BABYLON.Tools.ToRadians(90),
          beta: BABYLON.Tools.ToRadians(65),
          radius: bounds.radius * 1.1,
          target: baseTarget.clone(),
        },
        {
          label: "Top",
          alpha: BABYLON.Tools.ToRadians(0),
          beta: BABYLON.Tools.ToRadians(0),
          radius: bounds.radius * 1.4,
          target: baseTarget.clone(),
        },
      ];

      currentCameraConfigIndex = 0;
      isAnimatingCamera = false;
      applyCameraConfig(cameraConfigs[0]);
      updateCameraButtonState();
    };

    const updateModelButtonState = () => {
      if (modelFiles.length <= 1) {
        nextModelButton.textContent = "Options";
        nextModelButton.disabled = true;
        return;
      }
      nextModelButton.textContent = "Options";
      nextModelButton.disabled = false;
    };

    const loadModelByIndex = async (index) => {
      if (isLoadingModel) {
        return;
      }
      isLoadingModel = true;
      nextModelButton.disabled = true;
      nextModelButton.textContent = "Loading...";
      resetCameraConfigs();

      const modelName = modelFiles[index];
      let loadSucceeded = false;

      try {
        clearShadowCasters();
        disposeCurrentImport();

        const result = await BABYLON.SceneLoader.ImportMeshAsync("", rootUrl, modelName, scene);
        currentImport = result;

        const renderableMeshes = result.meshes.filter((mesh) => isRenderableMesh(mesh));

        renderableMeshes.forEach((mesh) => {
          mesh.receiveShadows = true;
          shadowGenerator.addShadowCaster(mesh, true);
        });

        const targetMeshes = renderableMeshes.length ? renderableMeshes : result.meshes;
        const bounds = computeBoundsForMeshes(targetMeshes);
        setupCameraConfigs(bounds);
        currentModelIndex = index;
        applyBeamMaterialToNode();
        console.log(modelName);
        loadSucceeded = true;
      } catch (error) {
        console.error(`Failed to load GLB model "${modelName}":`, error);
        nextModelButton.textContent = "Retry";
        nextModelButton.disabled = false;
      } finally {
        isLoadingModel = false;
        if (loadSucceeded) {
          updateModelButtonState();
        }
      }
    };

    nextModelButton.addEventListener("click", () => {
      if (isLoadingModel) {
        return;
      }
      const nextIndex = (currentModelIndex + 1) % modelFiles.length;
      loadModelByIndex(nextIndex);
    });

    cameraButton.addEventListener("click", () => {
      if (isAnimatingCamera || !cameraConfigs.length) {
        return;
      }
      const nextIndex = (currentCameraConfigIndex + 1) % cameraConfigs.length;
      currentCameraConfigIndex = nextIndex;
      animateCameraTo(cameraConfigs[nextIndex]);
    });

    updateCameraButtonState();

    await loadModelByIndex(currentModelIndex);

    return scene;
  };

  createScene().then((scene) => {
    engine.runRenderLoop(() => {
      scene.render();
    });
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
});
