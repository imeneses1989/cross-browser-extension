<script lang="ts">
	import browser from "webextension-polyfill";
	import Header from "./Header.svelte";

	// Interfaces/types
	interface Options {
		disableAllClicks: boolean;
		randomizeElements: boolean;
	}
	// variables
	export let showStatus = false;
	export let options: Options;

	// functions
	const handleOptions = (event, optionId) => {
		const { checked } = event.target;
		options[optionId] = checked;
	};

	// Saves options to chrome.storage
	const saveOptions = async () => {
		const { disableAllClicks, randomizeElements } = options;
		await browser.storage.local.set({ disableAllClicks, randomizeElements });
		showStatus = true;
		setTimeout(() => {
			showStatus = false;
		}, 3000);
	};

	// Restores select box and checkbox state using the preferences
	// stored in chrome.storage.
	const restoreOptions = async () => {
		options = await browser.storage.local.get({
			disableAllClicks: false,
			randomizeElements: false,
		});
		console.log("options", options);
	};

	// Event listeners
	document.addEventListener("DOMContentLoaded", restoreOptions);
</script>

<style>
	.manage-ext-link {
		color: #0d2d44;
		text-decoration: none;
	}
	.manage-ext-link:hover {
		color: #007da5;
	}
	.saved-message {
		background-color: lightgrey;
		padding: 5px;
	}
	.action-container {
		padding: 20px;
		border: 1px solid lightgrey;
		margin-top: 20px;
	}
	.btn-primary {
		background-color: #04ff88;
		padding: 5px 20px;
		border: none;
		margin-top: 20px;
	}
	.btn-primary:hover {
		background-color: #00aa5f;
	}
</style>

<main class="flex-col">
	<Header />
	<div class="flex justify-end pt-5 pb-5">
		<a class="manage-ext-link" href="popup.html">Back</a>
	</div>
	<span
		class="saved-message"
		style="display: {showStatus ? 'block' : 'none'}"
		id="status">Options saved.</span
	>
	<div class="action-container">
		<form action="#" method="get">
			<div>
				<input
					id="disableAllClicks"
					checked="{options && options.disableAllClicks}"
					on:click="{(e) => handleOptions(e, 'disableAllClicks')}"
					type="checkbox"
				/>
				Can't click on anything
			</div>

			<div>
				<input
					id="randomizeElements"
					checked="{options && options.randomizeElements}"
					on:click="{(e) => handleOptions(e, 'randomizeElements')}"
					type="checkbox"
				/>
				Randomize elements
			</div>

			<button class="btn-primary" id="save" on:click="{saveOptions}"
				>Save</button
			>
		</form>
	</div>
</main>
