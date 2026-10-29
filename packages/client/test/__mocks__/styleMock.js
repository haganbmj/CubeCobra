// Stylesheets carry no behavior for jest to assert on, and its transform cannot parse CSS.
// `RenderToRoot` imports the global stylesheets so Vite bundles and manifests them, so any
// test that mounts it reaches this stub. Mapped in jest.config.js.
module.exports = {};
