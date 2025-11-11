document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("renderCanvas");
  const cameraButton = document.getElementById("cycleCamera");
  const nextModelButton = document.getElementById("loadNextModel");
  const roofButton = document.getElementById("toggleRoof");
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
    scene.clearColor = BABYLON.Color3.White();
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
      createGround: true,
      skyboxSize: 250,
      groundSize: 200,
      enableGroundMirror: false,
      skyboxColor: BABYLON.Color3.White(),
      groundColor: BABYLON.Color3.White(),
    });

    if (environment?.skybox) {
      const whiteSkyboxMaterial = new BABYLON.StandardMaterial("whiteSkyboxMat", scene);
      whiteSkyboxMaterial.disableLighting = true;
      whiteSkyboxMaterial.diffuseColor = BABYLON.Color3.White();
      whiteSkyboxMaterial.specularColor = BABYLON.Color3.Black();
      whiteSkyboxMaterial.emissiveColor = BABYLON.Color3.White();
      environment.skybox.material = whiteSkyboxMaterial;
      environment.skybox.infiniteDistance = true;
    }

    if (environment?.ground) {
      const groundMat = new BABYLON.PBRMaterial("groundMat", scene);
      groundMat.albedoColor = BABYLON.Color3.White();
      groundMat.roughness = 1.0;
      groundMat.metallic = 0.0;
      environment.ground.material = groundMat;
      environment.ground.receiveShadows = true;
      if (!environment.ground.position) {
        environment.ground.position = BABYLON.Vector3.Zero();
      }
      environment.ground.position.y -= 0.1;
    }

    const sun = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(-0.4, -1, -0.6), scene);
    sun.position = new BABYLON.Vector3(60, 120, 80);
    sun.intensity = 2.6;
    sun.diffuse = BABYLON.Color3.White();
    sun.specular = BABYLON.Color3.White();
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 500;

    const fillLight = new BABYLON.HemisphericLight("fillLight", new BABYLON.Vector3(0, 1, 0), scene);
    fillLight.intensity = 0.2;

    const rootUrl = "Models/";

    let currentImport = null;
    let currentModelIndex = 0;
    let isLoadingModel = false;
    let cameraConfigs = [];
    let currentCameraConfigIndex = 0;
    let isAnimatingCamera = false;
    let beamMaterial = null;
    const roofLiftAmount = 10;
    let roofNode = null;
    let roofInitialY = null;
    let isRoofRaised = false;
    let isRoofAnimating = false;
    let levelNode = null;
    let levelBounds = null;
    let levelCameraConfig = null;
    let levelReturnCameraConfig = null;
    let isLevelViewActive = false;
    let isLevelTransitioning = false;
    const levelCameraLabel = "Level1_ZoomIn";

    const edgeColor = new BABYLON.Color4(0, 0, 0, 1);
    const textNodeAliases = ["text"];
    const textRendererColor = new BABYLON.Color4(2, 2, 2, 1);
    const textRendererUpVector = BABYLON.Vector3.Up();
    let textRendererObserver = null;
    let textRendererEntries = [];
    let textFontAssetPromise = null;

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

    const enableEdgesForMeshes = (meshes = []) => {
      meshes.forEach((mesh) => {
        if (!isRenderableMesh(mesh) || typeof mesh.enableEdgesRendering !== "function") {
          return;
        }
        mesh.enableEdgesRendering();
        mesh.edgesWidth = 4.0;
        mesh.edgesColor = edgeColor;
      });
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
      disposeTextRenderers();
      currentImport.animationGroups?.forEach((group) => group.dispose());
      currentImport.meshes?.forEach((mesh) => {
        if (mesh && !mesh.isDisposed()) {
          mesh.dispose(false, true);
        }
      });
      currentImport.skeletons?.forEach((skeleton) => skeleton.dispose());
      currentImport = null;
    };

    const logNodesUnderRoot = (modelName) => {
      const rootNode =
        scene.getTransformNodeByName?.("__root__") ||
        scene.getNodeByName?.("__root__");
      if (!rootNode) {
        console.warn(`No "__root__" node found for ${modelName}.`);
        return;
      }

      const maxDepth = 4; // __root__ + three transform layers + meshes
      const describeNode = (node, depth = 0) => {
        if (!node) {
          return null;
        }
        const info = {
          name: node.name || node.id || `unnamed-${node.uniqueId ?? "?"}`,
          type: typeof node.getClassName === "function" ? node.getClassName() : node.constructor?.name || "Node",
        };

        const children = typeof node.getChildren === "function" ? node.getChildren() : [];
        if (!children.length || depth >= maxDepth) {
          if (children.length && depth >= maxDepth) {
            info.children = `+${children.length} more`;
          }
          return info;
        }

        info.children = children.map((child) => describeNode(child, depth + 1)).filter(Boolean);
        return info;
      };

      const hierarchy = describeNode(rootNode);
      console.log(`Hierarchy under "__root__" for "${modelName}":\n${JSON.stringify(hierarchy, null, 2)}`);
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

    const normalizeNodeName = (value) => {
      if (!value || typeof value !== "string") {
        return "";
      }
      return value.replace(/[\s_-]+/g, "").toLowerCase();
    };

    const resolveRoofNode = () => {
      if (roofNode && typeof roofNode.isDisposed === "function" && roofNode.isDisposed()) {
        roofNode = null;
        roofInitialY = null;
        isRoofRaised = false;
      }
      if (!roofNode) {
        const candidates = [
          scene.getTransformNodeByName?.("Roof"),
          scene.getNodeByName?.("Roof"),
          ...(scene.transformNodes || []),
          ...(scene.meshes || []),
        ].filter(Boolean);

        const match = candidates.find((node) => {
          const normalizedName = normalizeNodeName(node.name);
          const normalizedId = normalizeNodeName(node.id);
          return (
            normalizedName === "roof" ||
            normalizedId === "roof" ||
            normalizedName.endsWith("roof") ||
            normalizedId.endsWith("roof")
          );
        });
        roofNode = match || null;
      }
      if (roofNode) {
        if (!roofNode.position) {
          roofNode.position = BABYLON.Vector3.Zero();
        }
        if (roofInitialY === null) {
          roofInitialY = roofNode.position.y;
        }
      }
      return roofNode;
    };

    const resetRoofState = () => {
      roofNode = null;
      roofInitialY = null;
      isRoofRaised = false;
      isRoofAnimating = false;
    };

    const resolveLevelNode = () => {
      if (levelNode && typeof levelNode.isDisposed === "function" && levelNode.isDisposed()) {
        levelNode = null;
      }
      if (!levelNode) {
        const candidates = [
          scene.getTransformNodeByName?.("Level1"),
          scene.getNodeByName?.("Level1"),
          ...(scene.transformNodes || []),
          ...(scene.meshes || []),
        ].filter(Boolean);

        const match = candidates.find((node) => {
          const normalizedName = normalizeNodeName(node.name);
          const normalizedId = normalizeNodeName(node.id);
          return (
            normalizedName === "level1" ||
            normalizedId === "level1" ||
            normalizedName.endsWith("level1") ||
            normalizedId.endsWith("level1")
          );
        });
        levelNode = match || null;
      }
      return levelNode;
    };

    const findTextNodeUnderLevel = () => {
      const level = resolveLevelNode();
      if (!level) {
        return null;
      }
      const matchesAlias = (node) => {
        if (!node) {
          return false;
        }
        const normalizedName = normalizeNodeName(node.name);
        const normalizedId = normalizeNodeName(node.id);
        return textNodeAliases.some(
          (alias) =>
            normalizedName === alias ||
            normalizedId === alias ||
            normalizedName.endsWith(alias) ||
            normalizedId.endsWith(alias)
        );
      };

      if (matchesAlias(level)) {
        return level;
      }

      const descendants =
        typeof level.getDescendants === "function" ? level.getDescendants(false) : level.getChildren?.() || [];
      if (!Array.isArray(descendants) || !descendants.length) {
        return null;
      }
      return descendants.find((node) => matchesAlias(node)) || null;
    };

    const collectTextMeshesUnderTextNode = () => {
      const textNode = findTextNodeUnderLevel();
      if (!textNode) {
        return [];
      }

      const meshes = [];
      const addIfMesh = (node) => {
        if (isRenderableMesh(node)) {
          meshes.push(node);
        }
      };

      addIfMesh(textNode);

      const descendants =
        typeof textNode.getDescendants === "function" ? textNode.getDescendants(false) : textNode.getChildren?.() || [];
      if (Array.isArray(descendants)) {
        descendants.forEach(addIfMesh);
      }

      return meshes;
    };

    const updateTextRendererEntryTransform = (entry, cameraPosition) => {
      const { mesh, textRenderer, localOffset, scaleVector } = entry;
      if (!mesh || mesh.isDisposed?.() || !textRenderer || !localOffset || !scaleVector) {
        return;
      }
      const parentWorld = mesh.getWorldMatrix?.();
      if (!parentWorld) {
        return;
      }
      const worldPosition = BABYLON.Vector3.TransformCoordinates(localOffset, parentWorld);
      const direction = cameraPosition.subtract(worldPosition);
      if (!isFinite(direction.x) || !isFinite(direction.y) || !isFinite(direction.z)) {
        return;
      }
      if (direction.lengthSquared() < 1e-5) {
        direction.x = 0;
        direction.y = 0;
        direction.z = 1;
      } else {
        direction.normalize();
      }
      const rotation = BABYLON.Quaternion.FromLookDirectionLH(direction, textRendererUpVector);
      const worldMatrix = BABYLON.Matrix.Compose(scaleVector, rotation, worldPosition);
      const parentInverse = BABYLON.Matrix.Invert(parentWorld);
      const localMatrix = worldMatrix.multiply(parentInverse);
      textRenderer.transformMatrix = localMatrix;
    };

    const disposeTextRenderers = () => {
      if (textRendererEntries.length) {
        textRendererEntries.forEach(({ textRenderer, mesh }) => {
          try {
            textRenderer?.dispose?.();
          } catch (error) {
            console.warn(`[TextRenderer] Failed to dispose renderer for "${mesh?.name || "unnamed"}".`, error);
          }
        });
        textRendererEntries = [];
      }
      if (textRendererObserver) {
        scene.onAfterRenderObservable.remove(textRendererObserver);
        textRendererObserver = null;
      }
      if (scene.metadata?.textRendererEntries) {
        delete scene.metadata.textRendererEntries;
      }
    };

    const loadTextFontAsset = async () => {
      if (!window.ADDONS?.FontAsset) {
        console.warn("[TextRenderer] Babylon.js addons FontAsset is unavailable. Labels will be skipped.");
        return null;
      }
      if (!textFontAssetPromise) {
        textFontAssetPromise = (async () => {
          const response = await fetch("https://assets.babylonjs.com/fonts/roboto-regular.json");
          if (!response.ok) {
            throw new Error(`Failed to load font definition (status ${response.status}).`);
          }
          const definition = await response.text();
          return new ADDONS.FontAsset(definition, "https://assets.babylonjs.com/fonts/roboto-regular.png");
        })();
      }

      try {
        return await textFontAssetPromise;
      } catch (error) {
        console.error("[TextRenderer] Unable to initialize font asset.", error);
        textFontAssetPromise = null;
        return null;
      }
    };

    const ensureTextRenderersReady = async () => {
      if (!isLevelViewActive) {
        return;
      }
      if (!textRendererEntries.length) {
        const textMeshes = collectTextMeshesUnderTextNode();
        if (!textMeshes.length) {
          return;
        }
        if (!window.ADDONS?.TextRenderer?.CreateTextRendererAsync) {
          console.warn("[TextRenderer] Babylon.js addons TextRenderer is unavailable. Labels will be skipped.");
          return;
        }
        const fontAsset = await loadTextFontAsset();
        if (!fontAsset) {
          return;
        }

        const createdEntries = [];
        for (const mesh of textMeshes) {
          if (!mesh) {
            continue;
          }
          mesh.isVisible = false;
          try {
            const renderer = await ADDONS.TextRenderer.CreateTextRendererAsync(fontAsset, engine);
            renderer.addParagraph(mesh.name || "Label");
            renderer.color = textRendererColor;
            renderer.ignoreDepthBuffer = true;
            const boundingInfo = mesh.getBoundingInfo?.();
            const localCenter = boundingInfo?.boundingBox?.center?.clone() || BABYLON.Vector3.Zero();
            const extendSize = boundingInfo?.boundingBox?.extendSize || BABYLON.Vector3.One();
            const labelHeight = Math.max(extendSize.y, 0.5) + 0.25;
            const localOffset = new BABYLON.Vector3(localCenter.x, localCenter.y + labelHeight, localCenter.z);
            const maxHorizontal = Math.max(extendSize.x, extendSize.z);
            const uniformScale = Math.max(maxHorizontal * 0.15, 0.5);
            const scaleVector = new BABYLON.Vector3(uniformScale, uniformScale, uniformScale);
            renderer.transformMatrix = BABYLON.Matrix.Compose(scaleVector, BABYLON.Quaternion.Identity(), localOffset);
            renderer.parent = mesh;
            createdEntries.push({ mesh, textRenderer: renderer, localOffset, scaleVector });
          } catch (error) {
            console.error(`[TextRenderer] Failed to create renderer for "${mesh?.name || "unnamed"}".`, error);
          }
        }

        if (!createdEntries.length) {
          return;
        }
        textRendererEntries = createdEntries;
        scene.metadata = scene.metadata || {};
        scene.metadata.textRendererEntries = textRendererEntries;
      }

      if (!textRendererObserver) {
        textRendererObserver = scene.onAfterRenderObservable.add(() => {
          if (!isLevelViewActive || !textRendererEntries.length) {
            return;
          }
          const activeCamera = scene.activeCamera || camera;
          if (!activeCamera) {
            return;
          }
          const cameraWorldPosition = activeCamera.globalPosition || activeCamera.position;
          if (!cameraWorldPosition) {
            return;
          }
          const viewMatrix = activeCamera.getViewMatrix();
          const projectionMatrix = activeCamera.getProjectionMatrix();
          textRendererEntries.forEach((entry) => {
            try {
              updateTextRendererEntryTransform(entry, cameraWorldPosition);
              entry.textRenderer.render(viewMatrix, projectionMatrix);
            } catch (error) {
              console.error("[TextRenderer] Failed to render label.", error);
            }
          });
        });
      }
    };

    const resetLevelState = () => {
      levelNode = null;
      levelBounds = null;
      levelCameraConfig = null;
      levelReturnCameraConfig = null;
      isLevelViewActive = false;
      isLevelTransitioning = false;
    };

    const animateRoofLift = (shouldRaise) => {
      const node = resolveRoofNode();
      if (!node) {
        return Promise.resolve();
      }
      if (!node.position) {
        node.position = BABYLON.Vector3.Zero();
      }
      if (roofInitialY === null) {
        roofInitialY = node.position?.y ?? 0;
      }
      const startY = node.position?.y ?? roofInitialY;
      const targetY = roofInitialY + (shouldRaise ? roofLiftAmount : 0);

      return new Promise((resolve) => {
        const animatable = BABYLON.Animation.CreateAndStartAnimation(
          "roofToggle",
          node,
          "position.y",
          60,
          cameraAnimationFrames,
          startY,
          targetY,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT,
          cameraEase,
          () => {
            node.position.y = targetY;
            resolve();
          }
        );
        if (!animatable) {
          node.position.y = targetY;
          resolve();
        }
      });
    };

    const updateRoofButtonState = () => {
      if (!roofButton) {
        return;
      }
      const canResolveRoof = !isLoadingModel;
      const hasRoof = canResolveRoof ? !!resolveRoofNode() : false;
      const levelViewAvailable = !!levelCameraConfig;
      roofButton.textContent = isLevelViewActive ? "Exit Level 1" : "Level 1";
      roofButton.disabled =
        isLoadingModel || isRoofAnimating || isLevelTransitioning || !hasRoof || !levelViewAvailable;
    };

    const collectMeshesFromHierarchy = (rootNode) => {
      if (!rootNode) {
        return [];
      }
      const collected = [];
      const seenIds = new Set();

      const addMesh = (mesh) => {
        if (!isRenderableMesh(mesh)) {
          return;
        }
        const key = mesh.uniqueId ?? mesh.id ?? mesh.name;
        if (key === undefined || key === null) {
          collected.push(mesh);
          return;
        }
        if (seenIds.has(key)) {
          return;
        }
        seenIds.add(key);
        collected.push(mesh);
      };

      const traverse = (node) => {
        if (!node) {
          return;
        }
        if (isRenderableMesh(node)) {
          addMesh(node);
        }
        if (typeof node.getChildMeshes === "function") {
          const meshes = node.getChildMeshes(false) || [];
          meshes.forEach(addMesh);
        }
        const children = typeof node.getChildren === "function" ? node.getChildren() : [];
        if (Array.isArray(children)) {
          children.forEach((child) => traverse(child));
        }
      };

      traverse(rootNode);
      return collected;
    };

    const collectLevelMeshes = () => {
      const node = resolveLevelNode();
      if (!node) {
        return [];
      }
      if (typeof node.getChildMeshes === "function") {
        const meshes = node.getChildMeshes(true);
        if (Array.isArray(meshes) && meshes.length) {
          return meshes;
        }
      }
      return collectMeshesFromHierarchy(node);
    };

    const hideLevelMeshes = () => {
      const levelMeshes = collectLevelMeshes();
      levelMeshes.forEach((mesh) => {
        if (!mesh) {
          return;
        }
        mesh.isVisible = false;
        if (typeof mesh.setEnabled === "function") {
          mesh.setEnabled(false);
        }
      });
    };

    const updateLevelCameraConfig = (modelName) => {
      const node = resolveLevelNode();
      if (!node) {
        levelBounds = null;
        levelCameraConfig = null;
        console.log(`[Level1] No transform node named "Level1" found while loading "${modelName}".`);
        return;
      }
      let meshes = [];
      if (typeof node.getChildMeshes === "function") {
        meshes = node.getChildMeshes(true) || [];
      }
      if (!meshes.length) {
        meshes = collectMeshesFromHierarchy(node);
      }
      if (!meshes.length) {
        levelBounds = null;
        levelCameraConfig = null;
        console.log(
          `[Level1] Node "${node.name}" has no renderable child meshes (including nested descendants) to compute bounds.`
        );
        return;
      }
      const bounds = computeBoundsForMeshes(meshes);
      if (!bounds || !bounds.center) {
        levelBounds = null;
        levelCameraConfig = null;
        console.log(`[Level1] Failed to compute bounds for node "${node.name}".`);
        return;
      }
      levelBounds = bounds;
      const target = typeof bounds.center.clone === "function" ? bounds.center.clone() : bounds.center;
      levelCameraConfig = {
        label: levelCameraLabel,
        alpha: BABYLON.Tools.ToRadians(-60),
        beta: BABYLON.Tools.ToRadians(45),
        radius: (bounds.radius || 1) * 1,
        target,
      };
      const centerString =
        typeof bounds.center?.toString === "function"
          ? bounds.center.toString()
          : JSON.stringify(bounds.center);
      console.log(
        `[Level1] Bounds computed for node "${node.name}" in "${modelName}": center=${centerString}, radius=${bounds.radius?.toFixed?.(
          2
        ) ?? bounds.radius}`
      );
      console.log(`[Level1] Camera "${levelCameraLabel}" ready. Use the Level 1 button to focus.`);
    };

    const resetCameraConfigs = () => {
      cameraConfigs = [];
      currentCameraConfigIndex = 0;
      isAnimatingCamera = false;
      updateCameraButtonState();
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
        return Promise.resolve();
      }
      isAnimatingCamera = true;
      updateCameraButtonState();

      return new Promise((resolve) => {
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
          resolve();
        };

        if (targetAnimatable) {
          targetAnimatable.onAnimationEndObservable.addOnce(() => {
            finalize();
          });
        } else {
          finalize();
        }
      });
    };

    const captureCurrentCameraState = () => ({
      label: "Current",
      alpha: camera.alpha,
      beta: camera.beta,
      radius: camera.radius,
      target: camera.target.clone(),
    });

    const resolveFallbackCameraConfig = () =>
      levelReturnCameraConfig ||
      cameraConfigs[currentCameraConfigIndex] ||
      cameraConfigs[0] ||
      captureCurrentCameraState();

    const toggleLevelView = async (desiredState = null) => {
      if (isRoofAnimating || isLevelTransitioning || isAnimatingCamera || isLoadingModel) {
        return false;
      }

      const targetState = typeof desiredState === "boolean" ? desiredState : !isLevelViewActive;
      if (targetState === isLevelViewActive) {
        return false;
      }

      const hasRoof = !!resolveRoofNode();
      if (!hasRoof) {
        console.warn('[Level1] Cannot toggle Level 1 view because no "Roof" node is present.');
        updateRoofButtonState();
        return false;
      }

      if (!levelCameraConfig) {
        console.warn("[Level1] Level 1 camera is unavailable for the current model.");
        updateRoofButtonState();
        return false;
      }

      let targetCameraConfig;
      if (targetState) {
        levelReturnCameraConfig = captureCurrentCameraState();
        targetCameraConfig = levelCameraConfig;
        console.log(
          `[Level1] Entering Level 1 view "${levelCameraLabel}" targeting ${
            levelCameraConfig.target.toString?.() || JSON.stringify(levelCameraConfig.target)
          }.`
        );
      } else {
        targetCameraConfig = resolveFallbackCameraConfig();
        console.log(
          `[Level1] Exiting Level 1 view. Returning to "${targetCameraConfig.label || "previous"}" camera.`
        );
      }

      isLevelTransitioning = true;
      isRoofAnimating = true;
      updateRoofButtonState();

      try {
        await Promise.all([animateCameraTo(targetCameraConfig), animateRoofLift(targetState)]);
        isLevelViewActive = targetState;
        isRoofRaised = targetState;
        if (targetState) {
          await ensureTextRenderersReady();
        } else {
          levelReturnCameraConfig = null;
          disposeTextRenderers();
        }
      } finally {
        isRoofAnimating = false;
        isLevelTransitioning = false;
        updateRoofButtonState();
      }

      return true;
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
          beta: BABYLON.Tools.ToRadians(60),
          radius: bounds.radius * 2,
          target: baseTarget.clone(),
        },
        {
          label: "Front",
          alpha: BABYLON.Tools.ToRadians(0),
          beta: BABYLON.Tools.ToRadians(75),
          radius: bounds.radius * 2,
          target: baseTarget.clone(),
        },
        {
          label: "Side",
          alpha: BABYLON.Tools.ToRadians(90),
          beta: BABYLON.Tools.ToRadians(65),
          radius: bounds.radius * 2,
          target: baseTarget.clone(),
        },
        {
          label: "Top",
          alpha: BABYLON.Tools.ToRadians(0),
          beta: BABYLON.Tools.ToRadians(0),
          radius: bounds.radius * 2,
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
      disposeTextRenderers();
      resetRoofState();
      updateRoofButtonState();
      resetLevelState();
      updateRoofButtonState();
      resetCameraConfigs();

      const modelName = modelFiles[index];
      let loadSucceeded = false;

      try {
        clearShadowCasters();
        disposeCurrentImport();
        const result = await BABYLON.SceneLoader.ImportMeshAsync("", rootUrl, modelName, scene);
        currentImport = result;
        logNodesUnderRoot(modelName);
        updateRoofButtonState();
        updateLevelCameraConfig(modelName);
        hideLevelMeshes();
        updateRoofButtonState();

        const renderableMeshes = result.meshes.filter((mesh) => isRenderableMesh(mesh));
        enableEdgesForMeshes(result.meshes);

        const hiddenTextMeshIds = new Set(textRendererEntries.map(({ mesh }) => mesh?.uniqueId).filter((id) => id !== undefined));

        renderableMeshes.forEach((mesh) => {
          mesh.receiveShadows = true;
          shadowGenerator.addShadowCaster(mesh, true);
        });

        const targetMeshes = renderableMeshes.length ? renderableMeshes : result.meshes;
        const bounds = computeBoundsForMeshes(targetMeshes);
        setupCameraConfigs(bounds);
        currentModelIndex = index;
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
        updateRoofButtonState();
      }
    };


    nextModelButton.addEventListener("click", () => {
      if (isLoadingModel) {
        return;
      }
      const nextIndex = (currentModelIndex + 1) % modelFiles.length;
      loadModelByIndex(nextIndex);
    });

    cameraButton.addEventListener("click", async () => {
      if (isAnimatingCamera || !cameraConfigs.length) {
        return;
      }
      if (isLevelViewActive) {
        const exited = await toggleLevelView(false);
        if (!exited) {
          return;
        }
      }
      const nextIndex = (currentCameraConfigIndex + 1) % cameraConfigs.length;
      currentCameraConfigIndex = nextIndex;
      await animateCameraTo(cameraConfigs[nextIndex]);
    });

    if (roofButton) {
      roofButton.addEventListener("click", async () => {
        await toggleLevelView();
      });
    }

    updateCameraButtonState();
    updateRoofButtonState();

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
