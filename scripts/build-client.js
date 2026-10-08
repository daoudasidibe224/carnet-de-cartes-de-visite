const esbuild = require("esbuild");
const options = {
  entryPoints: ["client/site.ts"],
  outdir: "public/js",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  minify: true,
};
if (process.argv.includes("--watch"))
  esbuild
    .context(options)
    .then((context) => context.watch())
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
else esbuild.buildSync(options);
