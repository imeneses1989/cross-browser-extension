import browser from "webextension-polyfill";
import init, { greet } from "./wasm";
// import { validateHeaderValue } from "http";

browser.runtime.onInstalled.addListener(() => {
	console.log("Extension installed successfully!");
});

browser.runtime.onMessage.addListener(async () => {
	await init();
	const response = await greet();
	return response;
});

// ***** Lifecycle functions *****

const onInitServiceWorker = () => {
	//Native Host connection initialization
	globalThis.name = browser.runtime.getManifest().short_name;
};

const startServiceWorker = (message) => {
	console.log(
		`Service Worker: Starting - ${message}`,
		globalThis.name,
		new Date(),
	);
	globalThis.port = browser.runtime.connectNative(globalThis.name);
};

const onDisconnectFromNativeHost = () => {
	console.log(
		"Service Worker: Disconnected",
		browser.runtime.lastError,
		new Date(),
	);
	startServiceWorker("after disconecting");
};

const onInstall = (reason) => {
	console.log("Service Worker: Service Worker Installed", reason, new Date());
};

// ***** Init *****
onInitServiceWorker();
startServiceWorker("After init");
console.log(
	"Service Worker: Service Worker started",
	globalThis.name,
	new Date(),
);

// ***** Communication functions ******
// Todo: Review
const receiveMessageFromNativeHost = (message) => {
	console.log(
		"Service Worker: Received message from Native Host: ",
		message,
		new Date(),
	);
};

const receiveMessageFromContentScript = (message, sender) => {
	const { key } = message;
	receiversFunctions[key](message, sender);
	console.log("service worker recived a message from content", message, sender);
};

const sendMessageToNativeHost = (messageObj) => {
	console.log("sending message to native host...", messageObj);
	globalThis.port.postMessage(messageObj);
	// chrome.runtime.sendNativeMessage(globalThis.name, messageObj, (response) => {
	//   console.log("Received from Native host ", response);
	// });
};

const sendMessageToContentScript = (messageObj) => {
	console.log("sendMessageToContentScript", messageObj.tabId);
	browser.tabs.sendMessage(messageObj.tabId, messageObj);
};

// ****** Constants ******
const prohibetedDomains = ["facebook.com", "pinterest.com"];

// ***** Business logic functions ******
const onCloseCurrentTab = (request, sender) => {
	browser.tabs.remove(sender.tab.id);
};

const isInList = (value, list) => {
	const element = list.find((el) => {
		return value.includes(el);
	});
	return element;
};

const getCurrentTab = async () => {
	let queryOptions = { active: true, lastFocusedWindow: true };
	// `tab` will either be a `tabs.Tab` instance or `undefined`.
	let [tab] = await browser.tabs.query(queryOptions);
	return tab;
};

// Check if is a forbidden domain
const onTabUpdated = async (tabId, tab) => {
	if (tab && tab.status === "complete") {
		const currentTab = await getCurrentTab();
		if (currentTab.url && isInList(currentTab.url, prohibetedDomains)) {
			console.log("currentTab", currentTab);
			sendMessageToNativeHost({
				key: "blackListedDomain",
				body: currentTab.url,
				tabId: tabId,
				query: "blackListedDomain",
			});
			sendMessageToContentScript({
				key: "blackListedDomain",
				body: currentTab.url,
				tabId: tabId,
			});
		}
	}
};

// ***** Config functions ******
const receiversFunctions = {
	closeCurrentTab: onCloseCurrentTab,
};

const onUninstallExternal = (info) => {
	sendMessageToNativeHost({
		key: "externalUninstalled",
		body: info,
		query: "externalUninstalled",
	});
};

// Monitor functions
// Note: Send mesage to content opening a new tab and asking user to iitiate the uninstall
// If user doe snot initiate, IT gets a report with user or machine name to ask why
const onExternalInstall = (info) => {
	console.log(info);
	const allowedExtensions = [];
	const { name, id } = info;
	if (name && isInList(name, allowedExtensions)) {
		sendMessageToNativeHost({
			key: "newPluginInstalled",
			body: info,
			query: "newPluginInstalled",
		});
	} else {
		sendMessageToNativeHost({
			key: "notAllowedExtension",
			body: info,
			query: "notAllowedExtension",
		});
		browser.management.uninstall(
			id,
			{ showConfirmDialog: false },
			onUninstallExternal,
		);
	}
};

// ***** Event listeners ******
globalThis.port.onMessage.addListener(receiveMessageFromNativeHost);
browser.runtime.onMessage.addListener(receiveMessageFromContentScript);
globalThis.port.onDisconnect.addListener(onDisconnectFromNativeHost);
browser.runtime.onInstalled.addListener(onInstall);
browser.management.onInstalled.addListener(onExternalInstall);
browser.tabs.onUpdated.addListener(onTabUpdated);
