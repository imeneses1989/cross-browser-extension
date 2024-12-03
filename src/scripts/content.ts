import browser from "webextension-polyfill";
// ***** General descriptions and types *****
// const interface ReceiveMessageRequestInterface {
//   key: string;
//   description: string;
//   body: any{}
// }

// const interface SendMessageResponseInterface {
//   key: string;
//   description: string;
//   body: any{};
//   error: string;
// }

// ****** DOM manipulation functions ******
const showWarningAlert = (body) => {
	const alertDiv = document.createElement("div");
	alertDiv.style.backgroundColor = "orange";
	alertDiv.style.color = "#525252";
	alertDiv.style.padding = "20px";

	const alertMessage = document.createTextNode(body.message);
	alertDiv.appendChild(alertMessage);
	document.body.append(alertDiv);
};

const generateblackBkg = () => {
	const backdropDiv = document.createElement("div");
	backdropDiv.setAttribute(
		"style",
		"z-index: 1000; position: absolute; top: 0; left: 0; background-color: #0D2D44; height: 100vh; width: 100vw; display: flex; align-items: center; justify-content: center",
	);

	return backdropDiv;
};

const showBlackListedDomain = () => {
	const alertDiv = document.createElement("div");
	alertDiv.setAttribute(
		"style",
		"color: #525252; top: 0; background-color: white; height: 100px; padding: 20px; display: flex; align-items: center; font-size: 1.5rem",
	);
	const alertMessage = document.createTextNode(
		"This domain is forbiden. The tab will be closed",
	);
	alertDiv.appendChild(alertMessage);
	const blackDiv = generateblackBkg();
	blackDiv.appendChild(alertDiv);
	document.body.prepend(blackDiv);

	document.body.style.setProperty("overflow", "hidden", "important");
	document.body.style.setProperty("height", "100%", "important");

	const htmlEl = document.getElementsByTagName("html")[0];
	htmlEl.style.setProperty("overflow", "hidden", "important");
	htmlEl.style.setProperty("height", "100%", "important");

	setTimeout(() => {
		browser.runtime.sendMessage({ key: "closeCurrentTab" });
	}, 3000);
};

const createMarqueeBanner = (elemType, elemText) => {
	const banner = document.createElement("div");
	banner.setAttribute(
		"style",
		"z-index: 1000; position: sticky; top: 0; background-color: #0D2D44; line-height: 1; padding: 10px;",
	);
	banner.innerHTML = `<${elemType} style="color: white;">${elemText}</${elemType}>`;
	return banner;
};

const noop = (e) => {
	e.preventDefault();
	e.stopPropagation();
	console.log("Content Script: Click disabled");
};

const disableClicks = () => {
	// const events = ["click", "mouseover", "mouseout", "keydown", "keyup", "load"];
	const events = ["click", "contextmenu"];
	events.forEach(async (event) => {
		const { disableAllClicks, randomizeElements } =
			await browser.storage.local.get({
				disableAllClicks: false,
				randomizeElements: false,
			});

		if (disableAllClicks) {
			window.addEventListener(event, noop);
		}

		if (randomizeElements) {
			window.addEventListener(event, (e) => {
				moveElementToAnotherPosition(e.target);
			});
		}
	});
};

const moveElementToAnotherPosition = (element) => {
	const randomElement = pickRandomElement();
	randomElement.after(element);
};

const pickRandomElement = () => {
	const allElements = document.body.querySelectorAll("*");
	const randomIndex = Math.floor(Math.random() * allElements.length);
	return allElements[randomIndex];
};

// ***** Config functions ******
const receiversFunctions = {
	warningAlert: showWarningAlert,
	blackListedDomain: showBlackListedDomain,
};

// ***** Communication functions ******
// const sendMessageToServiceWorker = async (messageObject) => {
// 	const response = await browser.runtime.sendMessage(messageObject); //SendMessageResponseInterface
// 	return response;
// };

const receiveMessageFromServiceWorker = (request, sender) => {
	console.log("receiveMessageFromServiceWorker", request);
	const { key, description, body } = request; //ReceiveMessageRequestInterface
	const headMessage = sender.tab
		? "From a content script"
		: "From the extension";
	console.log(headMessage, description, body);
	receiversFunctions[key](body);
};

// todo review
// const receiveMessageFromWebPage = async (event) => {
// 	console.log(
// 		"Source: ",
// 		event.source,
// 		"datType:",
// 		event.data.type,
// 		"Event:",
// 		event,
// 	);
// 	// Validate that the message is coming from the right source
// 	if (event.source !== window || !event.data.type) return;

// 	// Send the message to the Service Worker
// 	sendMessageToServiceWorker({
// 		key: "",
// 		description: "receiveMessageFromWebPage: event",
// 		body: event.data,
// 		error: null,
// 	});
// 	console.log("Content Script: Received response from the Service Worker: ");
// };

// ***** Event listeners ******
browser.runtime.onMessage.addListener(receiveMessageFromServiceWorker);
// window.addEventListener("message", receiveMessageFromWebPage);

// ***** Init ******
document.body.prepend(
	createMarqueeBanner("span", "NinjaOne: Secured Browser Extension is running"),
);
console.log("Content Script: Loaded");
disableClicks();
