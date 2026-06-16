AnimateMesh breast-physics export package

Baked GLB: exported-model-baked.glb
Runtime GLB: exported-model-runtime.glb
Runtime script: breast-physics-runtime.js
Config JSON: breast-physics.json

Use the baked GLB when you want the exported animations to already contain breast motion in generic viewers.
Use the runtime GLB together with the JSON + runtime script when you want live secondary motion in a Three.js scene.

Detected breast bones: breast_l, breast_r

Important:
- Do not run the runtime script on the baked GLB or the breast motion will be applied twice.
- The runtime script expects your app to use Three.js and to call controller.update(deltaTime) every frame.