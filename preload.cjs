'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function on(channel, callback) { const listener = (_event, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); }
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  get: () => ipcRenderer.invoke('reader:get'), settings: () => ipcRenderer.invoke('reader:settings'), save: value => ipcRenderer.invoke('reader:save', value),
  importBook: () => ipcRenderer.invoke('reader:import'),
  preview: value => ipcRenderer.invoke('reader:preview', value), locate: () => ipcRenderer.invoke('reader:locate'), quit: () => ipcRenderer.invoke('reader:quit'),
  dialog: value => ipcRenderer.invoke('reader:dialog', value), resizeStart: edge => ipcRenderer.invoke('reader:resize-start', edge),
  resizeMove: () => ipcRenderer.invoke('reader:resize-move'), resizeEnd: () => ipcRenderer.invoke('reader:resize-end'),
  onPreferences: callback => on('reader:preferences', callback), onBounds: callback => on('reader:bounds', callback), onPage: callback => on('reader:page', callback), onError: callback => on('reader:error', callback),
  onPointer: callback => on('reader:pointer', callback)
}));
