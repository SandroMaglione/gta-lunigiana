# Render standards

Checks for a change in `src/render`, the camera, the view or the keys, on top of the steps in
[CODING_STANDARDS.md](../../CODING_STANDARDS.md):

- **Settled design**: the user chose the look and the controls, so keep them unless the user asks
  for a change: real low-poly 3D rendered at low resolution and upscaled nearest-neighbour, with
  no sprites; an orthographic camera at 30°, for exact 2:1 pixel lines; the home view north-west of
  the player; quarter turns on Q/E, eased over about 1/3 s; the sun turning with the view; F or
  Enter as the action key; on a touch screen, every control on the screen (a stick to walk; in a
  vehicle ◀ ▶ buttons on the left and Gas and Brake on the right, pressing the keys as the
  keyboard does) and the game landscape only, turned a quarter when the phone is held upright.
- **Axes**: Three.js world axes are (east, up, −north), so the map point (x, y) at height h is
  (x, h, −y).
- **Streaming**: a chunk build keeps giving the same result as cutting the same area from a
  whole-map build ([architecture.md](../architecture.md), "Rendering"). A new mesh, geometry or
  buffer is disposed when the chunk or node that owns it is dropped: an x-ray proxy once leaked
  GPU memory.
- **Terrain fits**: anything fitted to the terrain samples the whole view, interior included: a
  valley deep inside the frame escapes a fit built on the view's edges (PR #2's shadow box).
- **Performance**: measure in the browser ([playtest.md](playtest.md)) and update
  architecture.md's numbers: first frame, JS heap after GC, chunk build times, and 60 fps with no
  frame over 30 ms.
