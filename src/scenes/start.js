import {Scene, HemisphericLight, Vector3, MeshBuilder, ArcRotateCamera, FreeCamera} from 'babylonjs'



export async function startScene(engine) {
    const scene = new Scene(engine);

    const cam = new FreeCamera("cam", new Vector3(0, 0, -2), scene);
    // cam.setTarget(Vector3.Zero());
    cam.attachControl();
    const light = new HemisphericLight("light", new Vector3(0, 2, 0), scene);
    const box = MeshBuilder.CreateBox("box", {size: .5}, scene);

    await scene.createDefaultXRExperienceAsync({
        uiOptions: {
            sessionMode: 'immersive-vr'
        }
    })

    await scene.whenReadyAsync();

    return scene;
}
