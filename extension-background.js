// Click the toolbar icon to open Ieum as a full-size extension page.
// No host permissions, content scripts, or remote server are required.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});
