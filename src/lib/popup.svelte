<script lang="ts">
	import browser from "webextension-polyfill";
	import Header from "./Header.svelte";
	interface Options {
		disableAllClicks: boolean;
		randomizeElements: boolean;
	}
	export let options: Options;

	// Translation texts
	export const manageExtText = browser.i18n.getMessage("manage_extension");
	export const selectedOptText = browser.i18n.getMessage("selected_options");
	export const clickMeText = browser.i18n.getMessage("click_me");
	export const noClickText = browser.i18n.getMessage("can_not_click");
	export const clickEnabledText = browser.i18n.getMessage("click_enabled");
	export const randomizeElsText = browser.i18n.getMessage("randomize_els");
	export const noRandomizeElsText =
		browser.i18n.getMessage("not_randomize_els");

	// Functions
	const openFullscreen = () => {
		browser.tabs.create({ url: browser.runtime.getURL("dashboard.html") });
	};

	// const sendMessage = async () => {
	// 	const response = await browser.runtime.sendMessage({
	// 		message: "Hello from NinjaOne",
	// 	});
	// 	console.log(response);
	// };

	const retrieveOptions = async () => {
		options = await browser.storage.local.get({
			disableAllClicks: false,
			randomizeElements: false,
		});
		console.log("options", options);
	};
	document.addEventListener("DOMContentLoaded", retrieveOptions);
</script>

<style>
	.njo-bkg-color {
		background-color: #007da5;
	}
	.manage-ext-container {
		padding: 10px 0;
		justify-content: flex-end;
	}

	.manage-ext-link {
		color: #0d2d44;
		text-decoration: none;
	}

	.manage-ext-link:hover {
		color: #007da5;
	}
</style>

<!-- justify-center items-center -->
<main class="flex flex-col">
	<Header />
	<div class="flex-col">
		<form action="#" method="get">
			<div class="flex manage-ext-container">
				<a class="manage-ext-link" href="dashboard.html">{manageExtText}</a>
			</div>
			<div class="p-5 selected-options-container">
				<h2 class="text-lg">{selectedOptText}</h2>
				{#if options}
					<ul>
						<li class="ml-5">
							{options.disableAllClicks ? noClickText : clickEnabledText}
						</li>
						<li class="ml-5">
							{options.randomizeElements
								? randomizeElsText
								: noRandomizeElsText}
						</li>
					</ul>
				{/if}
			</div>
		</form>
		<div class="flex justify-end">
			<button
				class="njo-bkg-color px-[6px] py-[10px] mt-6 text-white font-semibold"
				on:click="{openFullscreen}"
			>
				{clickMeText}
			</button>
		</div>
	</div>
</main>
