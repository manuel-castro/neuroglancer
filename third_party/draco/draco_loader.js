// Global Draco decoder.
let decoderModule = {};
let dracoDecoderType = {};

// This function loads a JavaScript file and adds it to the page. "path" is
// the path to the JavaScript file. "onLoadFunc" is the function to be called
// when the JavaScript file has been loaded.
function loadJavaScriptFile(path, onLoadFunc) {
  const head = document.getElementsByTagName('head')[0];
  const element = document.createElement('script');
  element.type = 'text/javascript';
  element.src = path;
  if (onLoadFunc !== null)
    element.onload = onLoadFunc;

  head.appendChild(element);
}

function loadWebAssemblyDecoder() {
  dracoDecoderType['wasmBinaryFile'] = 'draco_decoder.wasm';

  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'draco_decoder.wasm', true);
  xhr.responseType = 'arraybuffer';

  xhr.onload = function() {
    // For WebAssembly the object passed into DracoModule() must contain a
    // property with the name of wasmBinary and the value must be an
    // ArrayBuffer containing the contents of the .wasm file.
    dracoDecoderType['wasmBinary'] = xhr.response;
    createDecoderModule();
  };

  xhr.send(null)
}

function createDecoderModule() {
    // draco_decoder.js or draco_wasm_wrapper.js must be loaded before
    // DracoModule is created.
    if (typeof dracoDecoderType === 'undefined')
      dracoDecoderType = {};
    dracoDecoderType['onModuleLoaded'] = function(module) {
      enableButtons();
    };
    const create_t0 = performance.now();
  
    decoderModule = DracoDecoderModule(dracoDecoderType);
    const create_t1 = performance.now();
    addCell('DracoModule', true);
    addCell(' ' + (create_t1 - create_t0), false);
  }