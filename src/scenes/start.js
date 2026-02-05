import {Scene, HemisphericLight, Vector3, MeshBuilder, ArcRotateCamera, FreeCamera} from 'babylonjs'



export async function startScene(engine) {
    const scene = new Scene(engine);

    const cam = new FreeCamera("cam", new Vector3(.25, 2, -8), scene);
    cam.rotation = new Vector3(0.19996493417004554, -6.291316540956004, 0); 
    // cam.setTarget(Vector3.Zero());
    cam.attachControl();
    const light = new HemisphericLight("light", new Vector3(0, 2, 0), scene);
    const box = MeshBuilder.CreateBox("box", {size: .5}, scene);
    var ground = BABYLON.MeshBuilder.CreateGround("ground", {width: 6, height: 6}, scene);
    ground.position.y = -.25;
    

    await scene.createDefaultXRExperienceAsync({
        uiOptions: {
            sessionMode: 'immersive-vr'
        }
    })

    await scene.whenReadyAsync();

    return scene;
}
