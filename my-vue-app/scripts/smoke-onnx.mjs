import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as ort from 'onnxruntime-web'

const appRoot = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('public/models/manifest.json', appRoot), 'utf8'))
const model = await readFile(new URL('public/models/classifier.onnx', appRoot))

ort.env.wasm.numThreads = 1
const session = await ort.InferenceSession.create(model, {
  executionProviders: ['wasm'],
})

const inputName = manifest.inputName ?? session.inputNames[0]
const outputName = manifest.outputName ?? session.outputNames[0]
if (!inputName || !outputName) throw new Error('ONNX manifest does not identify input and output tensors')
if (!session.inputNames.includes(inputName) || !session.outputNames.includes(outputName)) {
  throw new Error(`ONNX tensor names do not match manifest: input=${inputName}, output=${outputName}`)
}

const featureSize = Number(manifest.featureSize)
const outputSize = Number(manifest.outputSize)
const outputs = await session.run({
  [inputName]: new ort.Tensor('float32', new Float32Array(featureSize), [1, featureSize]),
})
const values = outputs[outputName]?.data

if (!values || values.length !== outputSize) {
  throw new Error(`Unexpected ONNX output size: expected ${outputSize}, received ${values?.length ?? 0}`)
}
if (!Array.from(values, Number).every(Number.isFinite)) {
  throw new Error('ONNX smoke inference returned a non-finite value')
}

console.log(`ONNX smoke test passed: ${fileURLToPath(new URL('public/models/classifier.onnx', appRoot))}`)
