const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveTypeScriptAwareFilename(
  request,
  parent,
  isMain,
  options,
) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (
      error &&
      error.code === "MODULE_NOT_FOUND" &&
      typeof request === "string" &&
      request.startsWith(".") &&
      !/\.[a-z0-9]+$/i.test(request)
    ) {
      for (const extension of [".ts", ".tsx"]) {
        try {
          return originalResolveFilename.call(
            this,
            `${request}${extension}`,
            parent,
            isMain,
            options,
          );
        } catch {
          // Try the next TypeScript extension before rethrowing the original error.
        }
      }
    }

    throw error;
  }
};

function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });

  module._compile(output.outputText, filename);
}

require.extensions[".ts"] = compileTypeScript;
require.extensions[".tsx"] = compileTypeScript;
