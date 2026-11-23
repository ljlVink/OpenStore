const { AsyncLocalStorage } = require('node:async_hooks');

const invocation = new AsyncLocalStorage();

function runWithRuntime(env, ctx, request, handler) {
  return invocation.run({ env, ctx, request, serveAssets: false }, handler);
}

function bindings() {
  const current = invocation.getStore();
  if (!current) throw new Error('Missing Worker invocation context');
  return current.env;
}

function incomingRequest() {
  return invocation.getStore()?.request;
}

function defer(promise) {
  const job = promise.catch((error) => {
    console.error('[background]', error?.message || String(error));
  });
  invocation.getStore()?.ctx?.waitUntil(job);
  return job;
}

function markAssetFallback() {
  invocation.getStore().serveAssets = true;
}

function useAssetFallback() {
  return invocation.getStore().serveAssets;
}

module.exports = { runWithRuntime, bindings, incomingRequest, defer, markAssetFallback, useAssetFallback };
