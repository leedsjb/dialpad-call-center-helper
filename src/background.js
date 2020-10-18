chrome.runtime.onInstalled.addListener(function () {
  chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
    chrome.declarativeContent.onPageChanged.addRules([
      {
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({
            pageUrl: { hostEquals: "dialpad.com" },
          }),
        ],
        actions: [new chrome.declarativeContent.ShowPageAction()],
      },
    ]);
  });
});

// listen for real (user-created) XHR for user data
chrome.webRequest.onBeforeSendHeaders.addListener(
  async function (details) {
    // bail when we catch our own replay
    var match = details.url.match(
      /^https?:\/\/dialpad.com\/api\/user\/([^/?]+)$/
    );
    if (match) {
      console.log("onBeforeSendHeaders", details);
    } else {
      console.log("No match for XHR to URL: " + details.url);
      return;
    }

    const userId = match[1];

    // ensure we have headers
    const requestHeaders = details.requestHeaders;
    if (!requestHeaders) {
      throw new Error("No request headers captured in XHR call to " + details.url);
    }

    // clone headers from initial request
    const headers = {};
    requestHeaders.forEach((obj) => {
      headers[obj.name] = obj.value;
    });

    // store data locally for popup script to use
    const data = { headers, userId };
    console.log('Setting local storage', data);
    chrome.storage.local.set(data);
  },
  { urls: ["https://dialpad.com/api/user/*"] },
  ["requestHeaders"]
);
