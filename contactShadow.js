var createScene = function () {
    // This creates a basic Babylon Scene object (non-mesh)
    var scene = new BABYLON.Scene(engine);

    // This creates and positions a free camera (non-mesh)
    var camera = new BABYLON.ArcRotateCamera("camera", -Math.PI/2, Math.PI/3, 10, BABYLON.Vector3.Zero(), scene);

    camera.wheelPrecision = 50;

    // This targets the camera to scene origin
    camera.setTarget(BABYLON.Vector3.Zero());

    // This attaches the camera to the canvas
    camera.attachControl(canvas, true);

    // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
    var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

    // Default intensity is 1. Let's dim the light a small amount
    light.intensity = 0.7;

    var cube = BABYLON.MeshBuilder.CreateBox("box", {size: 1}, scene);
    cube.position.x = 1.5;
    cube.position.y = 1.0;

    const torus = BABYLON.MeshBuilder.CreateTorusKnot("torus", { radialSegments: 256, radius: 3, p: 1, q: 5 });
    torus.scaling.setAll(1/3);
    torus.position.x = -1.2;
    torus.position.y = 0.8;

    const ico = BABYLON.MeshBuilder.CreateIcoSphere("ico", { radius: 0.5, subdivisions: 1 }, scene);
    ico.position.z = -3;
    ico.position.y = 1;

    let t = 0.0;
    scene.onBeforeRenderObservable.add(() => {
        torus.rotation.x = t * 0.5;
        torus.rotation.y = t * 0.7 * 0.5;
        torus.rotation.z = t * 3 * 0.5;

        cube.rotation.x = -t;
        cube.rotation.y = t * 0.7;
        cube.rotation.z = -t * 1.97;

        ico.rotation.x = -t;
        ico.rotation.y = t * 0.7;
        ico.rotation.z = -t * 1.97;

        t += 0.01;
    });

    // Our built-in 'ground' shape.
    const gwidth = 10, gheight = 10;

    var ground = BABYLON.MeshBuilder.CreateGround("ground", {width: gwidth, height: gheight}, scene);

    const groundMat = new BABYLON.StandardMaterial("mat", scene);

    groundMat.diffuseTexture = new BABYLON.Texture("textures/ground.jpg", scene);

    ground.material = groundMat;

    const cameraBottom = camera.clone("camBottom");

    cameraBottom.radius = -1;
    cameraBottom.minZ = 1;
    cameraBottom.maxZ = 1.75;
    cameraBottom.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    cameraBottom.orthoLeft = -gwidth / 2;
    cameraBottom.orthoRight = gwidth / 2;
    cameraBottom.orthoTop = gheight / 2;
    cameraBottom.orthoBottom = -gheight / 2;
    cameraBottom.beta = 0;
    cameraBottom.alpha = Math.PI/2;

    const rtt = new BABYLON.RenderTargetTexture("rtt", 512, scene, {
        generateMipMaps: false
    });

    rtt.clearColor = new BABYLON.Color4(0, 0, 0, 0);
    rtt.activeCamera = cameraBottom;
    rtt.vScale = -1;
    rtt.useCameraPostProcesses = true;

    scene.customRenderTargets.push(rtt);

    const matDepth = [];
    const darkness = 1.5;

    const addMeshToRTT = (mesh) => {
        const material = mesh.material ?? scene.defaultMaterial;
        const materialForRTT = material.clone(material.name + "_rtt");

        const plugin = new DepthPluginMaterial(materialForRTT);

        plugin.isEnabled = true;
        plugin.darkness = darkness;

        materialForRTT.depthMat = plugin;

        rtt.setMaterialForRendering(mesh, materialForRTT);
        rtt.renderList.push(mesh);

        matDepth.push(materialForRTT);
    };

    addMeshToRTT(cube);
    addMeshToRTT(torus);
    addMeshToRTT(ico);

    const blurH = new BABYLON.BlurPostProcess("blurh", new BABYLON.Vector2(1, 0), 32, 1, cameraBottom);
    blurH.autoClear = false;

    const blurV = new BABYLON.BlurPostProcess("blurv", new BABYLON.Vector2(0, 1), 32, 1, cameraBottom);
    blurV.autoClear = false;

    const planeShadow = BABYLON.MeshBuilder.CreateGround("ground", {width: gwidth, height: gheight}, scene);
    planeShadow.position.y += 0.02;

    const matPlaneShadow = new BABYLON.StandardMaterial("matp", scene);

    matPlaneShadow.opacityTexture = rtt;
    matPlaneShadow.disableLighting = true;

    planeShadow.material = matPlaneShadow;

    // GUI
    var advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");

    var panel = new BABYLON.GUI.StackPanel();
    panel.width = "200px";
    panel.isVertical = true;
    panel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    panel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    advancedTexture.addControl(panel);

    var textBlock = new BABYLON.GUI.TextBlock();
    textBlock.text = "Plane color:";
    textBlock.height = "30px";
    panel.addControl(textBlock);     

    var picker = new BABYLON.GUI.ColorPicker();
    picker.height = "150px";
    picker.width = "150px";
    picker.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    picker.onValueChangedObservable.add(function(value) { // value is a color3
        groundMat.diffuseColor = value.clone();
    });

    panel.addControl(picker);     

    var headerDarkness = new BABYLON.GUI.TextBlock();
    headerDarkness.text = "Darkness";
    headerDarkness.height = "30px";
    headerDarkness.color = "black";
    panel.addControl(headerDarkness); 

    var sliderDarkness = new BABYLON.GUI.Slider();
    sliderDarkness.minimum = 0;
    sliderDarkness.maximum = 5;
    sliderDarkness.value = darkness;
    sliderDarkness.height = "20px";
    sliderDarkness.width = "160px";
    sliderDarkness.onValueChangedObservable.add(function(value) {
        matDepth.forEach((mat) => mat.depthMat.darkness = value);
    });
    panel.addControl(sliderDarkness);    

    var headerBlur = new BABYLON.GUI.TextBlock();
    headerBlur.text = "Blur";
    headerBlur.height = "30px";
    headerBlur.color = "black";
    panel.addControl(headerBlur); 

    var sliderBlur = new BABYLON.GUI.Slider();
    sliderBlur.minimum = 1;
    sliderBlur.maximum = 64;
    sliderBlur.value = 32;
    sliderBlur.height = "20px";
    sliderBlur.width = "160px";
    sliderBlur.onValueChangedObservable.add(function(value) {
        blurH.kernel = Math.floor(value);
        blurV.kernel = Math.floor(value);
    });
    panel.addControl(sliderBlur);    

    return scene;
};

class DepthPluginMaterial extends BABYLON.MaterialPluginBase {

    darkness = 1;

    get isEnabled() {
        return this._isEnabled;
    }

    set isEnabled(enabled) {
        if (this._isEnabled === enabled) {
            return;
        }
        this._isEnabled = enabled;
        this.markAllDefinesAsDirty();
        this._enable(this._isEnabled);
    }

    _isEnabled = false;

    constructor(material) {
        super(material, "Depth", 200, { "DEPTHMAT": false });
    }

    prepareDefines(defines, scene, mesh) {
        defines.DEPTHMAT = this._isEnabled;
    }

    getUniforms() {
        return {
            "ubo": [
                { name: "vdDarkness", size: 1, type: "float" },
            ],
            "fragment":
                `#ifdef DEPTHMAT
                    uniform float vdDarkness;
                #endif`,
        };
    }

    bindForSubMesh(uniformBuffer, scene, engine, subMesh) {
        if (this._isEnabled) {
            uniformBuffer.updateFloat("vdDarkness", this.darkness);
        }
    }

    getClassName() {
        return "DepthPluginMaterial";
    }

    getCustomCode(shaderType) {
        return shaderType === "vertex" ? {
            "CUSTOM_VERTEX_DEFINITIONS": `
                varying vec2 vdZW;
            `,
            "CUSTOM_VERTEX_MAIN_END": `
                vdZW = gl_Position.zw;
            `
        } : {
            "CUSTOM_FRAGMENT_DEFINITIONS": `
                varying vec2 vdZW;
            `,
            "CUSTOM_FRAGMENT_MAIN_BEGIN": `
                #ifdef DEPTHMAT
                    float vdDepth = 0.5 * vdZW.x / vdZW.y + 0.5;
                    gl_FragColor = vec4(vec3(0.), clamp((1.0 - vdDepth) * vdDarkness, 0., 1.));
                    return;
                #endif
            `,
        };
    }
}

export default createScene
