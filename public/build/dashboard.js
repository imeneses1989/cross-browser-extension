var app = (function () {
	'use strict';

	/** @returns {void} */
	function noop() {}

	/** @returns {void} */
	function add_location(element, file, line, column, char) {
		element.__svelte_meta = {
			loc: { file, line, column, char }
		};
	}

	function run(fn) {
		return fn();
	}

	function blank_object() {
		return Object.create(null);
	}

	/**
	 * @param {Function[]} fns
	 * @returns {void}
	 */
	function run_all(fns) {
		fns.forEach(run);
	}

	/**
	 * @param {any} thing
	 * @returns {thing is Function}
	 */
	function is_function(thing) {
		return typeof thing === 'function';
	}

	/** @returns {boolean} */
	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || (a && typeof a === 'object') || typeof a === 'function';
	}

	let src_url_equal_anchor;

	/**
	 * @param {string} element_src
	 * @param {string} url
	 * @returns {boolean}
	 */
	function src_url_equal(element_src, url) {
		if (element_src === url) return true;
		if (!src_url_equal_anchor) {
			src_url_equal_anchor = document.createElement('a');
		}
		// This is actually faster than doing URL(..).href
		src_url_equal_anchor.href = url;
		return element_src === src_url_equal_anchor.href;
	}

	/** @returns {boolean} */
	function is_empty(obj) {
		return Object.keys(obj).length === 0;
	}

	/** @type {typeof globalThis} */
	const globals =
		typeof window !== 'undefined'
			? window
			: typeof globalThis !== 'undefined'
			? globalThis
			: // @ts-ignore Node typings have this
			  global;

	/**
	 * @param {Node} target
	 * @param {Node} node
	 * @returns {void}
	 */
	function append(target, node) {
		target.appendChild(node);
	}

	/**
	 * @param {Node} target
	 * @param {Node} node
	 * @param {Node} [anchor]
	 * @returns {void}
	 */
	function insert(target, node, anchor) {
		target.insertBefore(node, anchor || null);
	}

	/**
	 * @param {Node} node
	 * @returns {void}
	 */
	function detach(node) {
		if (node.parentNode) {
			node.parentNode.removeChild(node);
		}
	}

	/**
	 * @template {keyof HTMLElementTagNameMap} K
	 * @param {K} name
	 * @returns {HTMLElementTagNameMap[K]}
	 */
	function element(name) {
		return document.createElement(name);
	}

	/**
	 * @param {string} data
	 * @returns {Text}
	 */
	function text(data) {
		return document.createTextNode(data);
	}

	/**
	 * @returns {Text} */
	function space() {
		return text(' ');
	}

	/**
	 * @param {EventTarget} node
	 * @param {string} event
	 * @param {EventListenerOrEventListenerObject} handler
	 * @param {boolean | AddEventListenerOptions | EventListenerOptions} [options]
	 * @returns {() => void}
	 */
	function listen(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	/**
	 * @param {Element} node
	 * @param {string} attribute
	 * @param {string} [value]
	 * @returns {void}
	 */
	function attr(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
	}

	/**
	 * @param {Element} element
	 * @returns {ChildNode[]}
	 */
	function children(element) {
		return Array.from(element.childNodes);
	}

	/**
	 * @returns {void} */
	function set_style(node, key, value, important) {
		if (value == null) {
			node.style.removeProperty(key);
		} else {
			node.style.setProperty(key, value, '');
		}
	}

	/**
	 * @template T
	 * @param {string} type
	 * @param {T} [detail]
	 * @param {{ bubbles?: boolean, cancelable?: boolean }} [options]
	 * @returns {CustomEvent<T>}
	 */
	function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
		return new CustomEvent(type, { detail, bubbles, cancelable });
	}

	/**
	 * @typedef {Node & {
	 * 	claim_order?: number;
	 * 	hydrate_init?: true;
	 * 	actual_end_child?: NodeEx;
	 * 	childNodes: NodeListOf<NodeEx>;
	 * }} NodeEx
	 */

	/** @typedef {ChildNode & NodeEx} ChildNodeEx */

	/** @typedef {NodeEx & { claim_order: number }} NodeEx2 */

	/**
	 * @typedef {ChildNodeEx[] & {
	 * 	claim_info?: {
	 * 		last_index: number;
	 * 		total_claimed: number;
	 * 	};
	 * }} ChildNodeArray
	 */

	let current_component;

	/** @returns {void} */
	function set_current_component(component) {
		current_component = component;
	}

	const dirty_components = [];
	const binding_callbacks = [];

	let render_callbacks = [];

	const flush_callbacks = [];

	const resolved_promise = /* @__PURE__ */ Promise.resolve();

	let update_scheduled = false;

	/** @returns {void} */
	function schedule_update() {
		if (!update_scheduled) {
			update_scheduled = true;
			resolved_promise.then(flush);
		}
	}

	/** @returns {void} */
	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	// flush() calls callbacks in this order:
	// 1. All beforeUpdate callbacks, in order: parents before children
	// 2. All bind:this callbacks, in reverse order: children before parents.
	// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
	//    for afterUpdates called during the initial onMount, which are called in
	//    reverse order: children before parents.
	// Since callbacks might update component values, which could trigger another
	// call to flush(), the following steps guard against this:
	// 1. During beforeUpdate, any updated components will be added to the
	//    dirty_components array and will cause a reentrant call to flush(). Because
	//    the flush index is kept outside the function, the reentrant call will pick
	//    up where the earlier call left off and go through all dirty components. The
	//    current_component value is saved and restored so that the reentrant call will
	//    not interfere with the "parent" flush() call.
	// 2. bind:this callbacks cannot trigger new flush() calls.
	// 3. During afterUpdate, any updated components will NOT have their afterUpdate
	//    callback called a second time; the seen_callbacks set, outside the flush()
	//    function, guarantees this behavior.
	const seen_callbacks = new Set();

	let flushidx = 0; // Do *not* move this inside the flush() function

	/** @returns {void} */
	function flush() {
		// Do not reenter flush while dirty components are updated, as this can
		// result in an infinite loop. Instead, let the inner flush handle it.
		// Reentrancy is ok afterwards for bindings etc.
		if (flushidx !== 0) {
			return;
		}
		const saved_component = current_component;
		do {
			// first, call beforeUpdate functions
			// and update components
			try {
				while (flushidx < dirty_components.length) {
					const component = dirty_components[flushidx];
					flushidx++;
					set_current_component(component);
					update(component.$$);
				}
			} catch (e) {
				// reset dirty state to not end up in a deadlocked state and then rethrow
				dirty_components.length = 0;
				flushidx = 0;
				throw e;
			}
			set_current_component(null);
			dirty_components.length = 0;
			flushidx = 0;
			while (binding_callbacks.length) binding_callbacks.pop()();
			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			for (let i = 0; i < render_callbacks.length; i += 1) {
				const callback = render_callbacks[i];
				if (!seen_callbacks.has(callback)) {
					// ...so guard against infinite loops
					seen_callbacks.add(callback);
					callback();
				}
			}
			render_callbacks.length = 0;
		} while (dirty_components.length);
		while (flush_callbacks.length) {
			flush_callbacks.pop()();
		}
		update_scheduled = false;
		seen_callbacks.clear();
		set_current_component(saved_component);
	}

	/** @returns {void} */
	function update($$) {
		if ($$.fragment !== null) {
			$$.update();
			run_all($$.before_update);
			const dirty = $$.dirty;
			$$.dirty = [-1];
			$$.fragment && $$.fragment.p($$.ctx, dirty);
			$$.after_update.forEach(add_render_callback);
		}
	}

	/**
	 * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
	 * @param {Function[]} fns
	 * @returns {void}
	 */
	function flush_render_callbacks(fns) {
		const filtered = [];
		const targets = [];
		render_callbacks.forEach((c) => (fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c)));
		targets.forEach((c) => c());
		render_callbacks = filtered;
	}

	const outroing = new Set();

	/**
	 * @type {Outro}
	 */
	let outros;

	/**
	 * @param {import('./private.js').Fragment} block
	 * @param {0 | 1} [local]
	 * @returns {void}
	 */
	function transition_in(block, local) {
		if (block && block.i) {
			outroing.delete(block);
			block.i(local);
		}
	}

	/**
	 * @param {import('./private.js').Fragment} block
	 * @param {0 | 1} local
	 * @param {0 | 1} [detach]
	 * @param {() => void} [callback]
	 * @returns {void}
	 */
	function transition_out(block, local, detach, callback) {
		if (block && block.o) {
			if (outroing.has(block)) return;
			outroing.add(block);
			outros.c.push(() => {
				outroing.delete(block);
			});
			block.o(local);
		}
	}

	/** @typedef {1} INTRO */
	/** @typedef {0} OUTRO */
	/** @typedef {{ direction: 'in' | 'out' | 'both' }} TransitionOptions */
	/** @typedef {(node: Element, params: any, options: TransitionOptions) => import('../transition/public.js').TransitionConfig} TransitionFn */

	/**
	 * @typedef {Object} Outro
	 * @property {number} r
	 * @property {Function[]} c
	 * @property {Object} p
	 */

	/**
	 * @typedef {Object} PendingProgram
	 * @property {number} start
	 * @property {INTRO|OUTRO} b
	 * @property {Outro} [group]
	 */

	/**
	 * @typedef {Object} Program
	 * @property {number} a
	 * @property {INTRO|OUTRO} b
	 * @property {1|-1} d
	 * @property {number} duration
	 * @property {number} start
	 * @property {number} end
	 * @property {Outro} [group]
	 */

	/** @returns {void} */
	function create_component(block) {
		block && block.c();
	}

	/** @returns {void} */
	function mount_component(component, target, anchor) {
		const { fragment, after_update } = component.$$;
		fragment && fragment.m(target, anchor);
		// onMount happens before the initial afterUpdate
		add_render_callback(() => {
			const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
			// if the component was destroyed immediately
			// it will update the `$$.on_destroy` reference to `null`.
			// the destructured on_destroy may still reference to the old array
			if (component.$$.on_destroy) {
				component.$$.on_destroy.push(...new_on_destroy);
			} else {
				// Edge case - component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});
		after_update.forEach(add_render_callback);
	}

	/** @returns {void} */
	function destroy_component(component, detaching) {
		const $$ = component.$$;
		if ($$.fragment !== null) {
			flush_render_callbacks($$.after_update);
			run_all($$.on_destroy);
			$$.fragment && $$.fragment.d(detaching);
			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			$$.on_destroy = $$.fragment = null;
			$$.ctx = [];
		}
	}

	/** @returns {void} */
	function make_dirty(component, i) {
		if (component.$$.dirty[0] === -1) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty.fill(0);
		}
		component.$$.dirty[(i / 31) | 0] |= 1 << i % 31;
	}

	// TODO: Document the other params
	/**
	 * @param {SvelteComponent} component
	 * @param {import('./public.js').ComponentConstructorOptions} options
	 *
	 * @param {import('./utils.js')['not_equal']} not_equal Used to compare props and state values.
	 * @param {(target: Element | ShadowRoot) => void} [append_styles] Function that appends styles to the DOM when the component is first initialised.
	 * This will be the `add_css` function from the compiled component.
	 *
	 * @returns {void}
	 */
	function init(
		component,
		options,
		instance,
		create_fragment,
		not_equal,
		props,
		append_styles = null,
		dirty = [-1]
	) {
		const parent_component = current_component;
		set_current_component(component);
		/** @type {import('./private.js').T$$} */
		const $$ = (component.$$ = {
			fragment: null,
			ctx: [],
			// state
			props,
			update: noop,
			not_equal,
			bound: blank_object(),
			// lifecycle
			on_mount: [],
			on_destroy: [],
			on_disconnect: [],
			before_update: [],
			after_update: [],
			context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
			// everything else
			callbacks: blank_object(),
			dirty,
			skip_bound: false,
			root: options.target || parent_component.$$.root
		});
		append_styles && append_styles($$.root);
		let ready = false;
		$$.ctx = instance
			? instance(component, options.props || {}, (i, ret, ...rest) => {
					const value = rest.length ? rest[0] : ret;
					if ($$.ctx && not_equal($$.ctx[i], ($$.ctx[i] = value))) {
						if (!$$.skip_bound && $$.bound[i]) $$.bound[i](value);
						if (ready) make_dirty(component, i);
					}
					return ret;
			  })
			: [];
		$$.update();
		ready = true;
		run_all($$.before_update);
		// `false` as a special case of no DOM component
		$$.fragment = create_fragment ? create_fragment($$.ctx) : false;
		if (options.target) {
			if (options.hydrate) {
				// TODO: what is the correct type here?
				// @ts-expect-error
				const nodes = children(options.target);
				$$.fragment && $$.fragment.l(nodes);
				nodes.forEach(detach);
			} else {
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				$$.fragment && $$.fragment.c();
			}
			if (options.intro) transition_in(component.$$.fragment);
			mount_component(component, options.target, options.anchor);
			flush();
		}
		set_current_component(parent_component);
	}

	/**
	 * Base class for Svelte components. Used when dev=false.
	 *
	 * @template {Record<string, any>} [Props=any]
	 * @template {Record<string, any>} [Events=any]
	 */
	class SvelteComponent {
		/**
		 * ### PRIVATE API
		 *
		 * Do not use, may change at any time
		 *
		 * @type {any}
		 */
		$$ = undefined;
		/**
		 * ### PRIVATE API
		 *
		 * Do not use, may change at any time
		 *
		 * @type {any}
		 */
		$$set = undefined;

		/** @returns {void} */
		$destroy() {
			destroy_component(this, 1);
			this.$destroy = noop;
		}

		/**
		 * @template {Extract<keyof Events, string>} K
		 * @param {K} type
		 * @param {((e: Events[K]) => void) | null | undefined} callback
		 * @returns {() => void}
		 */
		$on(type, callback) {
			if (!is_function(callback)) {
				return noop;
			}
			const callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
			callbacks.push(callback);
			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		/**
		 * @param {Partial<Props>} props
		 * @returns {void}
		 */
		$set(props) {
			if (this.$$set && !is_empty(props)) {
				this.$$.skip_bound = true;
				this.$$set(props);
				this.$$.skip_bound = false;
			}
		}
	}

	/**
	 * @typedef {Object} CustomElementPropDefinition
	 * @property {string} [attribute]
	 * @property {boolean} [reflect]
	 * @property {'String'|'Boolean'|'Number'|'Array'|'Object'} [type]
	 */

	// generated during release, do not modify

	/**
	 * The current version, as set in package.json.
	 *
	 * https://svelte.dev/docs/svelte-compiler#svelte-version
	 * @type {string}
	 */
	const VERSION = '4.2.19';
	const PUBLIC_VERSION = '4';

	/**
	 * @template T
	 * @param {string} type
	 * @param {T} [detail]
	 * @returns {void}
	 */
	function dispatch_dev(type, detail) {
		document.dispatchEvent(custom_event(type, { version: VERSION, ...detail }, { bubbles: true }));
	}

	/**
	 * @param {Node} target
	 * @param {Node} node
	 * @returns {void}
	 */
	function append_dev(target, node) {
		dispatch_dev('SvelteDOMInsert', { target, node });
		append(target, node);
	}

	/**
	 * @param {Node} target
	 * @param {Node} node
	 * @param {Node} [anchor]
	 * @returns {void}
	 */
	function insert_dev(target, node, anchor) {
		dispatch_dev('SvelteDOMInsert', { target, node, anchor });
		insert(target, node, anchor);
	}

	/**
	 * @param {Node} node
	 * @returns {void}
	 */
	function detach_dev(node) {
		dispatch_dev('SvelteDOMRemove', { node });
		detach(node);
	}

	/**
	 * @param {Node} node
	 * @param {string} event
	 * @param {EventListenerOrEventListenerObject} handler
	 * @param {boolean | AddEventListenerOptions | EventListenerOptions} [options]
	 * @param {boolean} [has_prevent_default]
	 * @param {boolean} [has_stop_propagation]
	 * @param {boolean} [has_stop_immediate_propagation]
	 * @returns {() => void}
	 */
	function listen_dev(
		node,
		event,
		handler,
		options,
		has_prevent_default,
		has_stop_propagation,
		has_stop_immediate_propagation
	) {
		const modifiers =
			[];
		dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
		const dispose = listen(node, event, handler, options);
		return () => {
			dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
			dispose();
		};
	}

	/**
	 * @param {Element} node
	 * @param {string} attribute
	 * @param {string} [value]
	 * @returns {void}
	 */
	function attr_dev(node, attribute, value) {
		attr(node, attribute, value);
		if (value == null) dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
		else dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
	}

	/**
	 * @param {Element} node
	 * @param {string} property
	 * @param {any} [value]
	 * @returns {void}
	 */
	function prop_dev(node, property, value) {
		node[property] = value;
		dispatch_dev('SvelteDOMSetProperty', { node, property, value });
	}

	/**
	 * @returns {void} */
	function validate_slots(name, slot, keys) {
		for (const slot_key of Object.keys(slot)) {
			if (!~keys.indexOf(slot_key)) {
				console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
			}
		}
	}

	/**
	 * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
	 *
	 * Can be used to create strongly typed Svelte components.
	 *
	 * #### Example:
	 *
	 * You have component library on npm called `component-library`, from which
	 * you export a component called `MyComponent`. For Svelte+TypeScript users,
	 * you want to provide typings. Therefore you create a `index.d.ts`:
	 * ```ts
	 * import { SvelteComponent } from "svelte";
	 * export class MyComponent extends SvelteComponent<{foo: string}> {}
	 * ```
	 * Typing this makes it possible for IDEs like VS Code with the Svelte extension
	 * to provide intellisense and to use the component like this in a Svelte file
	 * with TypeScript:
	 * ```svelte
	 * <script lang="ts">
	 * 	import { MyComponent } from "component-library";
	 * </script>
	 * <MyComponent foo={'bar'} />
	 * ```
	 * @template {Record<string, any>} [Props=any]
	 * @template {Record<string, any>} [Events=any]
	 * @template {Record<string, any>} [Slots=any]
	 * @extends {SvelteComponent<Props, Events>}
	 */
	class SvelteComponentDev extends SvelteComponent {
		/**
		 * For type checking capabilities only.
		 * Does not exist at runtime.
		 * ### DO NOT USE!
		 *
		 * @type {Props}
		 */
		$$prop_def;
		/**
		 * For type checking capabilities only.
		 * Does not exist at runtime.
		 * ### DO NOT USE!
		 *
		 * @type {Events}
		 */
		$$events_def;
		/**
		 * For type checking capabilities only.
		 * Does not exist at runtime.
		 * ### DO NOT USE!
		 *
		 * @type {Slots}
		 */
		$$slot_def;

		/** @param {import('./public.js').ComponentConstructorOptions<Props>} options */
		constructor(options) {
			if (!options || (!options.target && !options.$$inline)) {
				throw new Error("'target' is a required option");
			}
			super();
		}

		/** @returns {void} */
		$destroy() {
			super.$destroy();
			this.$destroy = () => {
				console.warn('Component was already destroyed'); // eslint-disable-line no-console
			};
		}

		/** @returns {void} */
		$capture_state() {}

		/** @returns {void} */
		$inject_state() {}
	}

	if (typeof window !== 'undefined')
		// @ts-ignore
		(window.__svelte || (window.__svelte = { v: new Set() })).v.add(PUBLIC_VERSION);

	var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function getDefaultExportFromCjs (x) {
		return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
	}

	var browserPolyfill = {exports: {}};

	(function (module, exports) {
		(function (global, factory) {
		  {
		    factory(module);
		  }
		})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : commonjsGlobal, function (module) {

		  if (!(globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id)) {
		    throw new Error("This script should only be loaded in a browser extension.");
		  }
		  if (!(globalThis.browser && globalThis.browser.runtime && globalThis.browser.runtime.id)) {
		    const CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE = "The message port closed before a response was received.";

		    // Wrapping the bulk of this polyfill in a one-time-use function is a minor
		    // optimization for Firefox. Since Spidermonkey does not fully parse the
		    // contents of a function until the first time it's called, and since it will
		    // never actually need to be called, this allows the polyfill to be included
		    // in Firefox nearly for free.
		    const wrapAPIs = extensionAPIs => {
		      // NOTE: apiMetadata is associated to the content of the api-metadata.json file
		      // at build time by replacing the following "include" with the content of the
		      // JSON file.
		      const apiMetadata = {
		        "alarms": {
		          "clear": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "clearAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "get": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "getAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          }
		        },
		        "bookmarks": {
		          "create": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "get": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getChildren": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getRecent": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getSubTree": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getTree": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "move": {
		            "minArgs": 2,
		            "maxArgs": 2
		          },
		          "remove": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeTree": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "search": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "update": {
		            "minArgs": 2,
		            "maxArgs": 2
		          }
		        },
		        "browserAction": {
		          "disable": {
		            "minArgs": 0,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "enable": {
		            "minArgs": 0,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "getBadgeBackgroundColor": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getBadgeText": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getPopup": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getTitle": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "openPopup": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "setBadgeBackgroundColor": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "setBadgeText": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "setIcon": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "setPopup": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "setTitle": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          }
		        },
		        "browsingData": {
		          "remove": {
		            "minArgs": 2,
		            "maxArgs": 2
		          },
		          "removeCache": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeCookies": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeDownloads": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeFormData": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeHistory": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeLocalStorage": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removePasswords": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removePluginData": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "settings": {
		            "minArgs": 0,
		            "maxArgs": 0
		          }
		        },
		        "commands": {
		          "getAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          }
		        },
		        "contextMenus": {
		          "remove": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "update": {
		            "minArgs": 2,
		            "maxArgs": 2
		          }
		        },
		        "cookies": {
		          "get": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getAll": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getAllCookieStores": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "remove": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "set": {
		            "minArgs": 1,
		            "maxArgs": 1
		          }
		        },
		        "devtools": {
		          "inspectedWindow": {
		            "eval": {
		              "minArgs": 1,
		              "maxArgs": 2,
		              "singleCallbackArg": false
		            }
		          },
		          "panels": {
		            "create": {
		              "minArgs": 3,
		              "maxArgs": 3,
		              "singleCallbackArg": true
		            },
		            "elements": {
		              "createSidebarPane": {
		                "minArgs": 1,
		                "maxArgs": 1
		              }
		            }
		          }
		        },
		        "downloads": {
		          "cancel": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "download": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "erase": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getFileIcon": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "open": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "pause": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeFile": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "resume": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "search": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "show": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          }
		        },
		        "extension": {
		          "isAllowedFileSchemeAccess": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "isAllowedIncognitoAccess": {
		            "minArgs": 0,
		            "maxArgs": 0
		          }
		        },
		        "history": {
		          "addUrl": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "deleteAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "deleteRange": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "deleteUrl": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getVisits": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "search": {
		            "minArgs": 1,
		            "maxArgs": 1
		          }
		        },
		        "i18n": {
		          "detectLanguage": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getAcceptLanguages": {
		            "minArgs": 0,
		            "maxArgs": 0
		          }
		        },
		        "identity": {
		          "launchWebAuthFlow": {
		            "minArgs": 1,
		            "maxArgs": 1
		          }
		        },
		        "idle": {
		          "queryState": {
		            "minArgs": 1,
		            "maxArgs": 1
		          }
		        },
		        "management": {
		          "get": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "getSelf": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "setEnabled": {
		            "minArgs": 2,
		            "maxArgs": 2
		          },
		          "uninstallSelf": {
		            "minArgs": 0,
		            "maxArgs": 1
		          }
		        },
		        "notifications": {
		          "clear": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "create": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "getAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "getPermissionLevel": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "update": {
		            "minArgs": 2,
		            "maxArgs": 2
		          }
		        },
		        "pageAction": {
		          "getPopup": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getTitle": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "hide": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "setIcon": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "setPopup": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "setTitle": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          },
		          "show": {
		            "minArgs": 1,
		            "maxArgs": 1,
		            "fallbackToNoCallback": true
		          }
		        },
		        "permissions": {
		          "contains": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getAll": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "remove": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "request": {
		            "minArgs": 1,
		            "maxArgs": 1
		          }
		        },
		        "runtime": {
		          "getBackgroundPage": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "getPlatformInfo": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "openOptionsPage": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "requestUpdateCheck": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "sendMessage": {
		            "minArgs": 1,
		            "maxArgs": 3
		          },
		          "sendNativeMessage": {
		            "minArgs": 2,
		            "maxArgs": 2
		          },
		          "setUninstallURL": {
		            "minArgs": 1,
		            "maxArgs": 1
		          }
		        },
		        "sessions": {
		          "getDevices": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "getRecentlyClosed": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "restore": {
		            "minArgs": 0,
		            "maxArgs": 1
		          }
		        },
		        "storage": {
		          "local": {
		            "clear": {
		              "minArgs": 0,
		              "maxArgs": 0
		            },
		            "get": {
		              "minArgs": 0,
		              "maxArgs": 1
		            },
		            "getBytesInUse": {
		              "minArgs": 0,
		              "maxArgs": 1
		            },
		            "remove": {
		              "minArgs": 1,
		              "maxArgs": 1
		            },
		            "set": {
		              "minArgs": 1,
		              "maxArgs": 1
		            }
		          },
		          "managed": {
		            "get": {
		              "minArgs": 0,
		              "maxArgs": 1
		            },
		            "getBytesInUse": {
		              "minArgs": 0,
		              "maxArgs": 1
		            }
		          },
		          "sync": {
		            "clear": {
		              "minArgs": 0,
		              "maxArgs": 0
		            },
		            "get": {
		              "minArgs": 0,
		              "maxArgs": 1
		            },
		            "getBytesInUse": {
		              "minArgs": 0,
		              "maxArgs": 1
		            },
		            "remove": {
		              "minArgs": 1,
		              "maxArgs": 1
		            },
		            "set": {
		              "minArgs": 1,
		              "maxArgs": 1
		            }
		          }
		        },
		        "tabs": {
		          "captureVisibleTab": {
		            "minArgs": 0,
		            "maxArgs": 2
		          },
		          "create": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "detectLanguage": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "discard": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "duplicate": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "executeScript": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "get": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getCurrent": {
		            "minArgs": 0,
		            "maxArgs": 0
		          },
		          "getZoom": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "getZoomSettings": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "goBack": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "goForward": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "highlight": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "insertCSS": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "move": {
		            "minArgs": 2,
		            "maxArgs": 2
		          },
		          "query": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "reload": {
		            "minArgs": 0,
		            "maxArgs": 2
		          },
		          "remove": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "removeCSS": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "sendMessage": {
		            "minArgs": 2,
		            "maxArgs": 3
		          },
		          "setZoom": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "setZoomSettings": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "update": {
		            "minArgs": 1,
		            "maxArgs": 2
		          }
		        },
		        "topSites": {
		          "get": {
		            "minArgs": 0,
		            "maxArgs": 0
		          }
		        },
		        "webNavigation": {
		          "getAllFrames": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "getFrame": {
		            "minArgs": 1,
		            "maxArgs": 1
		          }
		        },
		        "webRequest": {
		          "handlerBehaviorChanged": {
		            "minArgs": 0,
		            "maxArgs": 0
		          }
		        },
		        "windows": {
		          "create": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "get": {
		            "minArgs": 1,
		            "maxArgs": 2
		          },
		          "getAll": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "getCurrent": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "getLastFocused": {
		            "minArgs": 0,
		            "maxArgs": 1
		          },
		          "remove": {
		            "minArgs": 1,
		            "maxArgs": 1
		          },
		          "update": {
		            "minArgs": 2,
		            "maxArgs": 2
		          }
		        }
		      };
		      if (Object.keys(apiMetadata).length === 0) {
		        throw new Error("api-metadata.json has not been included in browser-polyfill");
		      }

		      /**
		       * A WeakMap subclass which creates and stores a value for any key which does
		       * not exist when accessed, but behaves exactly as an ordinary WeakMap
		       * otherwise.
		       *
		       * @param {function} createItem
		       *        A function which will be called in order to create the value for any
		       *        key which does not exist, the first time it is accessed. The
		       *        function receives, as its only argument, the key being created.
		       */
		      class DefaultWeakMap extends WeakMap {
		        constructor(createItem, items = undefined) {
		          super(items);
		          this.createItem = createItem;
		        }
		        get(key) {
		          if (!this.has(key)) {
		            this.set(key, this.createItem(key));
		          }
		          return super.get(key);
		        }
		      }

		      /**
		       * Returns true if the given object is an object with a `then` method, and can
		       * therefore be assumed to behave as a Promise.
		       *
		       * @param {*} value The value to test.
		       * @returns {boolean} True if the value is thenable.
		       */
		      const isThenable = value => {
		        return value && typeof value === "object" && typeof value.then === "function";
		      };

		      /**
		       * Creates and returns a function which, when called, will resolve or reject
		       * the given promise based on how it is called:
		       *
		       * - If, when called, `chrome.runtime.lastError` contains a non-null object,
		       *   the promise is rejected with that value.
		       * - If the function is called with exactly one argument, the promise is
		       *   resolved to that value.
		       * - Otherwise, the promise is resolved to an array containing all of the
		       *   function's arguments.
		       *
		       * @param {object} promise
		       *        An object containing the resolution and rejection functions of a
		       *        promise.
		       * @param {function} promise.resolve
		       *        The promise's resolution function.
		       * @param {function} promise.reject
		       *        The promise's rejection function.
		       * @param {object} metadata
		       *        Metadata about the wrapped method which has created the callback.
		       * @param {boolean} metadata.singleCallbackArg
		       *        Whether or not the promise is resolved with only the first
		       *        argument of the callback, alternatively an array of all the
		       *        callback arguments is resolved. By default, if the callback
		       *        function is invoked with only a single argument, that will be
		       *        resolved to the promise, while all arguments will be resolved as
		       *        an array if multiple are given.
		       *
		       * @returns {function}
		       *        The generated callback function.
		       */
		      const makeCallback = (promise, metadata) => {
		        return (...callbackArgs) => {
		          if (extensionAPIs.runtime.lastError) {
		            promise.reject(new Error(extensionAPIs.runtime.lastError.message));
		          } else if (metadata.singleCallbackArg || callbackArgs.length <= 1 && metadata.singleCallbackArg !== false) {
		            promise.resolve(callbackArgs[0]);
		          } else {
		            promise.resolve(callbackArgs);
		          }
		        };
		      };
		      const pluralizeArguments = numArgs => numArgs == 1 ? "argument" : "arguments";

		      /**
		       * Creates a wrapper function for a method with the given name and metadata.
		       *
		       * @param {string} name
		       *        The name of the method which is being wrapped.
		       * @param {object} metadata
		       *        Metadata about the method being wrapped.
		       * @param {integer} metadata.minArgs
		       *        The minimum number of arguments which must be passed to the
		       *        function. If called with fewer than this number of arguments, the
		       *        wrapper will raise an exception.
		       * @param {integer} metadata.maxArgs
		       *        The maximum number of arguments which may be passed to the
		       *        function. If called with more than this number of arguments, the
		       *        wrapper will raise an exception.
		       * @param {boolean} metadata.singleCallbackArg
		       *        Whether or not the promise is resolved with only the first
		       *        argument of the callback, alternatively an array of all the
		       *        callback arguments is resolved. By default, if the callback
		       *        function is invoked with only a single argument, that will be
		       *        resolved to the promise, while all arguments will be resolved as
		       *        an array if multiple are given.
		       *
		       * @returns {function(object, ...*)}
		       *       The generated wrapper function.
		       */
		      const wrapAsyncFunction = (name, metadata) => {
		        return function asyncFunctionWrapper(target, ...args) {
		          if (args.length < metadata.minArgs) {
		            throw new Error(`Expected at least ${metadata.minArgs} ${pluralizeArguments(metadata.minArgs)} for ${name}(), got ${args.length}`);
		          }
		          if (args.length > metadata.maxArgs) {
		            throw new Error(`Expected at most ${metadata.maxArgs} ${pluralizeArguments(metadata.maxArgs)} for ${name}(), got ${args.length}`);
		          }
		          return new Promise((resolve, reject) => {
		            if (metadata.fallbackToNoCallback) {
		              // This API method has currently no callback on Chrome, but it return a promise on Firefox,
		              // and so the polyfill will try to call it with a callback first, and it will fallback
		              // to not passing the callback if the first call fails.
		              try {
		                target[name](...args, makeCallback({
		                  resolve,
		                  reject
		                }, metadata));
		              } catch (cbError) {
		                console.warn(`${name} API method doesn't seem to support the callback parameter, ` + "falling back to call it without a callback: ", cbError);
		                target[name](...args);

		                // Update the API method metadata, so that the next API calls will not try to
		                // use the unsupported callback anymore.
		                metadata.fallbackToNoCallback = false;
		                metadata.noCallback = true;
		                resolve();
		              }
		            } else if (metadata.noCallback) {
		              target[name](...args);
		              resolve();
		            } else {
		              target[name](...args, makeCallback({
		                resolve,
		                reject
		              }, metadata));
		            }
		          });
		        };
		      };

		      /**
		       * Wraps an existing method of the target object, so that calls to it are
		       * intercepted by the given wrapper function. The wrapper function receives,
		       * as its first argument, the original `target` object, followed by each of
		       * the arguments passed to the original method.
		       *
		       * @param {object} target
		       *        The original target object that the wrapped method belongs to.
		       * @param {function} method
		       *        The method being wrapped. This is used as the target of the Proxy
		       *        object which is created to wrap the method.
		       * @param {function} wrapper
		       *        The wrapper function which is called in place of a direct invocation
		       *        of the wrapped method.
		       *
		       * @returns {Proxy<function>}
		       *        A Proxy object for the given method, which invokes the given wrapper
		       *        method in its place.
		       */
		      const wrapMethod = (target, method, wrapper) => {
		        return new Proxy(method, {
		          apply(targetMethod, thisObj, args) {
		            return wrapper.call(thisObj, target, ...args);
		          }
		        });
		      };
		      let hasOwnProperty = Function.call.bind(Object.prototype.hasOwnProperty);

		      /**
		       * Wraps an object in a Proxy which intercepts and wraps certain methods
		       * based on the given `wrappers` and `metadata` objects.
		       *
		       * @param {object} target
		       *        The target object to wrap.
		       *
		       * @param {object} [wrappers = {}]
		       *        An object tree containing wrapper functions for special cases. Any
		       *        function present in this object tree is called in place of the
		       *        method in the same location in the `target` object tree. These
		       *        wrapper methods are invoked as described in {@see wrapMethod}.
		       *
		       * @param {object} [metadata = {}]
		       *        An object tree containing metadata used to automatically generate
		       *        Promise-based wrapper functions for asynchronous. Any function in
		       *        the `target` object tree which has a corresponding metadata object
		       *        in the same location in the `metadata` tree is replaced with an
		       *        automatically-generated wrapper function, as described in
		       *        {@see wrapAsyncFunction}
		       *
		       * @returns {Proxy<object>}
		       */
		      const wrapObject = (target, wrappers = {}, metadata = {}) => {
		        let cache = Object.create(null);
		        let handlers = {
		          has(proxyTarget, prop) {
		            return prop in target || prop in cache;
		          },
		          get(proxyTarget, prop, receiver) {
		            if (prop in cache) {
		              return cache[prop];
		            }
		            if (!(prop in target)) {
		              return undefined;
		            }
		            let value = target[prop];
		            if (typeof value === "function") {
		              // This is a method on the underlying object. Check if we need to do
		              // any wrapping.

		              if (typeof wrappers[prop] === "function") {
		                // We have a special-case wrapper for this method.
		                value = wrapMethod(target, target[prop], wrappers[prop]);
		              } else if (hasOwnProperty(metadata, prop)) {
		                // This is an async method that we have metadata for. Create a
		                // Promise wrapper for it.
		                let wrapper = wrapAsyncFunction(prop, metadata[prop]);
		                value = wrapMethod(target, target[prop], wrapper);
		              } else {
		                // This is a method that we don't know or care about. Return the
		                // original method, bound to the underlying object.
		                value = value.bind(target);
		              }
		            } else if (typeof value === "object" && value !== null && (hasOwnProperty(wrappers, prop) || hasOwnProperty(metadata, prop))) {
		              // This is an object that we need to do some wrapping for the children
		              // of. Create a sub-object wrapper for it with the appropriate child
		              // metadata.
		              value = wrapObject(value, wrappers[prop], metadata[prop]);
		            } else if (hasOwnProperty(metadata, "*")) {
		              // Wrap all properties in * namespace.
		              value = wrapObject(value, wrappers[prop], metadata["*"]);
		            } else {
		              // We don't need to do any wrapping for this property,
		              // so just forward all access to the underlying object.
		              Object.defineProperty(cache, prop, {
		                configurable: true,
		                enumerable: true,
		                get() {
		                  return target[prop];
		                },
		                set(value) {
		                  target[prop] = value;
		                }
		              });
		              return value;
		            }
		            cache[prop] = value;
		            return value;
		          },
		          set(proxyTarget, prop, value, receiver) {
		            if (prop in cache) {
		              cache[prop] = value;
		            } else {
		              target[prop] = value;
		            }
		            return true;
		          },
		          defineProperty(proxyTarget, prop, desc) {
		            return Reflect.defineProperty(cache, prop, desc);
		          },
		          deleteProperty(proxyTarget, prop) {
		            return Reflect.deleteProperty(cache, prop);
		          }
		        };

		        // Per contract of the Proxy API, the "get" proxy handler must return the
		        // original value of the target if that value is declared read-only and
		        // non-configurable. For this reason, we create an object with the
		        // prototype set to `target` instead of using `target` directly.
		        // Otherwise we cannot return a custom object for APIs that
		        // are declared read-only and non-configurable, such as `chrome.devtools`.
		        //
		        // The proxy handlers themselves will still use the original `target`
		        // instead of the `proxyTarget`, so that the methods and properties are
		        // dereferenced via the original targets.
		        let proxyTarget = Object.create(target);
		        return new Proxy(proxyTarget, handlers);
		      };

		      /**
		       * Creates a set of wrapper functions for an event object, which handles
		       * wrapping of listener functions that those messages are passed.
		       *
		       * A single wrapper is created for each listener function, and stored in a
		       * map. Subsequent calls to `addListener`, `hasListener`, or `removeListener`
		       * retrieve the original wrapper, so that  attempts to remove a
		       * previously-added listener work as expected.
		       *
		       * @param {DefaultWeakMap<function, function>} wrapperMap
		       *        A DefaultWeakMap object which will create the appropriate wrapper
		       *        for a given listener function when one does not exist, and retrieve
		       *        an existing one when it does.
		       *
		       * @returns {object}
		       */
		      const wrapEvent = wrapperMap => ({
		        addListener(target, listener, ...args) {
		          target.addListener(wrapperMap.get(listener), ...args);
		        },
		        hasListener(target, listener) {
		          return target.hasListener(wrapperMap.get(listener));
		        },
		        removeListener(target, listener) {
		          target.removeListener(wrapperMap.get(listener));
		        }
		      });
		      const onRequestFinishedWrappers = new DefaultWeakMap(listener => {
		        if (typeof listener !== "function") {
		          return listener;
		        }

		        /**
		         * Wraps an onRequestFinished listener function so that it will return a
		         * `getContent()` property which returns a `Promise` rather than using a
		         * callback API.
		         *
		         * @param {object} req
		         *        The HAR entry object representing the network request.
		         */
		        return function onRequestFinished(req) {
		          const wrappedReq = wrapObject(req, {} /* wrappers */, {
		            getContent: {
		              minArgs: 0,
		              maxArgs: 0
		            }
		          });
		          listener(wrappedReq);
		        };
		      });
		      const onMessageWrappers = new DefaultWeakMap(listener => {
		        if (typeof listener !== "function") {
		          return listener;
		        }

		        /**
		         * Wraps a message listener function so that it may send responses based on
		         * its return value, rather than by returning a sentinel value and calling a
		         * callback. If the listener function returns a Promise, the response is
		         * sent when the promise either resolves or rejects.
		         *
		         * @param {*} message
		         *        The message sent by the other end of the channel.
		         * @param {object} sender
		         *        Details about the sender of the message.
		         * @param {function(*)} sendResponse
		         *        A callback which, when called with an arbitrary argument, sends
		         *        that value as a response.
		         * @returns {boolean}
		         *        True if the wrapped listener returned a Promise, which will later
		         *        yield a response. False otherwise.
		         */
		        return function onMessage(message, sender, sendResponse) {
		          let didCallSendResponse = false;
		          let wrappedSendResponse;
		          let sendResponsePromise = new Promise(resolve => {
		            wrappedSendResponse = function (response) {
		              didCallSendResponse = true;
		              resolve(response);
		            };
		          });
		          let result;
		          try {
		            result = listener(message, sender, wrappedSendResponse);
		          } catch (err) {
		            result = Promise.reject(err);
		          }
		          const isResultThenable = result !== true && isThenable(result);

		          // If the listener didn't returned true or a Promise, or called
		          // wrappedSendResponse synchronously, we can exit earlier
		          // because there will be no response sent from this listener.
		          if (result !== true && !isResultThenable && !didCallSendResponse) {
		            return false;
		          }

		          // A small helper to send the message if the promise resolves
		          // and an error if the promise rejects (a wrapped sendMessage has
		          // to translate the message into a resolved promise or a rejected
		          // promise).
		          const sendPromisedResult = promise => {
		            promise.then(msg => {
		              // send the message value.
		              sendResponse(msg);
		            }, error => {
		              // Send a JSON representation of the error if the rejected value
		              // is an instance of error, or the object itself otherwise.
		              let message;
		              if (error && (error instanceof Error || typeof error.message === "string")) {
		                message = error.message;
		              } else {
		                message = "An unexpected error occurred";
		              }
		              sendResponse({
		                __mozWebExtensionPolyfillReject__: true,
		                message
		              });
		            }).catch(err => {
		              // Print an error on the console if unable to send the response.
		              console.error("Failed to send onMessage rejected reply", err);
		            });
		          };

		          // If the listener returned a Promise, send the resolved value as a
		          // result, otherwise wait the promise related to the wrappedSendResponse
		          // callback to resolve and send it as a response.
		          if (isResultThenable) {
		            sendPromisedResult(result);
		          } else {
		            sendPromisedResult(sendResponsePromise);
		          }

		          // Let Chrome know that the listener is replying.
		          return true;
		        };
		      });
		      const wrappedSendMessageCallback = ({
		        reject,
		        resolve
		      }, reply) => {
		        if (extensionAPIs.runtime.lastError) {
		          // Detect when none of the listeners replied to the sendMessage call and resolve
		          // the promise to undefined as in Firefox.
		          // See https://github.com/mozilla/webextension-polyfill/issues/130
		          if (extensionAPIs.runtime.lastError.message === CHROME_SEND_MESSAGE_CALLBACK_NO_RESPONSE_MESSAGE) {
		            resolve();
		          } else {
		            reject(new Error(extensionAPIs.runtime.lastError.message));
		          }
		        } else if (reply && reply.__mozWebExtensionPolyfillReject__) {
		          // Convert back the JSON representation of the error into
		          // an Error instance.
		          reject(new Error(reply.message));
		        } else {
		          resolve(reply);
		        }
		      };
		      const wrappedSendMessage = (name, metadata, apiNamespaceObj, ...args) => {
		        if (args.length < metadata.minArgs) {
		          throw new Error(`Expected at least ${metadata.minArgs} ${pluralizeArguments(metadata.minArgs)} for ${name}(), got ${args.length}`);
		        }
		        if (args.length > metadata.maxArgs) {
		          throw new Error(`Expected at most ${metadata.maxArgs} ${pluralizeArguments(metadata.maxArgs)} for ${name}(), got ${args.length}`);
		        }
		        return new Promise((resolve, reject) => {
		          const wrappedCb = wrappedSendMessageCallback.bind(null, {
		            resolve,
		            reject
		          });
		          args.push(wrappedCb);
		          apiNamespaceObj.sendMessage(...args);
		        });
		      };
		      const staticWrappers = {
		        devtools: {
		          network: {
		            onRequestFinished: wrapEvent(onRequestFinishedWrappers)
		          }
		        },
		        runtime: {
		          onMessage: wrapEvent(onMessageWrappers),
		          onMessageExternal: wrapEvent(onMessageWrappers),
		          sendMessage: wrappedSendMessage.bind(null, "sendMessage", {
		            minArgs: 1,
		            maxArgs: 3
		          })
		        },
		        tabs: {
		          sendMessage: wrappedSendMessage.bind(null, "sendMessage", {
		            minArgs: 2,
		            maxArgs: 3
		          })
		        }
		      };
		      const settingMetadata = {
		        clear: {
		          minArgs: 1,
		          maxArgs: 1
		        },
		        get: {
		          minArgs: 1,
		          maxArgs: 1
		        },
		        set: {
		          minArgs: 1,
		          maxArgs: 1
		        }
		      };
		      apiMetadata.privacy = {
		        network: {
		          "*": settingMetadata
		        },
		        services: {
		          "*": settingMetadata
		        },
		        websites: {
		          "*": settingMetadata
		        }
		      };
		      return wrapObject(extensionAPIs, staticWrappers, apiMetadata);
		    };

		    // The build process adds a UMD wrapper around this file, which makes the
		    // `module` variable available.
		    module.exports = wrapAPIs(chrome);
		  } else {
		    module.exports = globalThis.browser;
		  }
		});
		
	} (browserPolyfill));

	var browserPolyfillExports = browserPolyfill.exports;
	var browser = /*@__PURE__*/getDefaultExportFromCjs(browserPolyfillExports);

	/* src/lib/Header.svelte generated by Svelte v4.2.19 */
	const file$1 = "src/lib/Header.svelte";

	function create_fragment$1(ctx) {
		let div;
		let img;
		let img_src_value;
		let t0;
		let h1;

		const block = {
			c: function create() {
				div = element("div");
				img = element("img");
				t0 = space();
				h1 = element("h1");
				h1.textContent = "NinjaOne Secured Browser extension";
				set_style(img, "width", "150px");
				if (!src_url_equal(img.src, img_src_value = "https://resources.ninjarmm.com/webapp/img/ninja_logo_dark.svg")) attr_dev(img, "src", img_src_value);
				attr_dev(img, "width", "100px");
				attr_dev(img, "height", "auto");
				add_location(img, file$1, 1, 4, 30);
				attr_dev(h1, "class", "svelte-1lclrov");
				add_location(h1, file$1, 7, 4, 187);
				attr_dev(div, "class", "flex header svelte-1lclrov");
				add_location(div, file$1, 0, 0, 0);
			},
			l: function claim(nodes) {
				throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
			},
			m: function mount(target, anchor) {
				insert_dev(target, div, anchor);
				append_dev(div, img);
				append_dev(div, t0);
				append_dev(div, h1);
			},
			p: noop,
			i: noop,
			o: noop,
			d: function destroy(detaching) {
				if (detaching) {
					detach_dev(div);
				}
			}
		};

		dispatch_dev("SvelteRegisterBlock", {
			block,
			id: create_fragment$1.name,
			type: "component",
			source: "",
			ctx
		});

		return block;
	}

	function instance$1($$self, $$props) {
		let { $$slots: slots = {}, $$scope } = $$props;
		validate_slots('Header', slots, []);
		const writable_props = [];

		Object.keys($$props).forEach(key => {
			if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Header> was created with unknown prop '${key}'`);
		});

		return [];
	}

	class Header extends SvelteComponentDev {
		constructor(options) {
			super(options);
			init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

			dispatch_dev("SvelteRegisterComponent", {
				component: this,
				tagName: "Header",
				options,
				id: create_fragment$1.name
			});
		}
	}

	/* src/lib/dashboard.svelte generated by Svelte v4.2.19 */

	const { console: console_1 } = globals;
	const file = "src/lib/dashboard.svelte";

	function create_fragment(ctx) {
		let main;
		let header;
		let t0;
		let div0;
		let a;
		let t2;
		let span;
		let t3;
		let t4;
		let div3;
		let form;
		let div1;
		let input0;
		let input0_checked_value;
		let t5;
		let t6;
		let div2;
		let input1;
		let input1_checked_value;
		let t7;
		let t8;
		let button;
		let current;
		let mounted;
		let dispose;
		header = new Header({ $$inline: true });

		const block = {
			c: function create() {
				main = element("main");
				create_component(header.$$.fragment);
				t0 = space();
				div0 = element("div");
				a = element("a");
				a.textContent = "Back";
				t2 = space();
				span = element("span");
				t3 = text("Options saved.");
				t4 = space();
				div3 = element("div");
				form = element("form");
				div1 = element("div");
				input0 = element("input");
				t5 = text("\n        Can't click on anything");
				t6 = space();
				div2 = element("div");
				input1 = element("input");
				t7 = text("\n        Randomize elements");
				t8 = space();
				button = element("button");
				button.textContent = "Save";
				attr_dev(a, "class", "manage-ext-link svelte-1kq7qi4");
				attr_dev(a, "href", "popup.html");
				add_location(a, file, 44, 4, 1044);
				attr_dev(div0, "class", "flex justify-end pt-5 pb-5");
				add_location(div0, file, 43, 2, 999);
				attr_dev(span, "class", "saved-message svelte-1kq7qi4");
				set_style(span, "display", /*showStatus*/ ctx[0] ? 'block' : 'none');
				attr_dev(span, "id", "status");
				add_location(span, file, 46, 2, 1109);
				attr_dev(input0, "id", "disableAllClicks");
				input0.checked = input0_checked_value = /*options*/ ctx[1] && /*options*/ ctx[1].disableAllClicks;
				attr_dev(input0, "type", "checkbox");
				add_location(input0, file, 50, 8, 1308);
				add_location(div1, file, 49, 6, 1294);
				attr_dev(input1, "id", "randomizeElements");
				input1.checked = input1_checked_value = /*options*/ ctx[1] && /*options*/ ctx[1].randomizeElements;
				attr_dev(input1, "type", "checkbox");
				add_location(input1, file, 55, 8, 1523);
				add_location(div2, file, 54, 6, 1509);
				attr_dev(button, "class", "btn-primary svelte-1kq7qi4");
				attr_dev(button, "id", "save");
				add_location(button, file, 59, 6, 1722);
				attr_dev(form, "action", "#");
				attr_dev(form, "method", "get");
				add_location(form, file, 48, 4, 1257);
				attr_dev(div3, "class", "action-container svelte-1kq7qi4");
				add_location(div3, file, 47, 2, 1222);
				attr_dev(main, "class", "flex-col");
				add_location(main, file, 41, 0, 961);
			},
			l: function claim(nodes) {
				throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
			},
			m: function mount(target, anchor) {
				insert_dev(target, main, anchor);
				mount_component(header, main, null);
				append_dev(main, t0);
				append_dev(main, div0);
				append_dev(div0, a);
				append_dev(main, t2);
				append_dev(main, span);
				append_dev(span, t3);
				append_dev(main, t4);
				append_dev(main, div3);
				append_dev(div3, form);
				append_dev(form, div1);
				append_dev(div1, input0);
				append_dev(div1, t5);
				append_dev(form, t6);
				append_dev(form, div2);
				append_dev(div2, input1);
				append_dev(div2, t7);
				append_dev(form, t8);
				append_dev(form, button);
				current = true;

				if (!mounted) {
					dispose = [
						listen_dev(input0, "click", /*click_handler*/ ctx[4], false),
						listen_dev(input1, "click", /*click_handler_1*/ ctx[5], false),
						listen_dev(button, "click", /*saveOptions*/ ctx[3], false)
					];

					mounted = true;
				}
			},
			p: function update(ctx, [dirty]) {
				if (!current || dirty & /*showStatus*/ 1) {
					set_style(span, "display", /*showStatus*/ ctx[0] ? 'block' : 'none');
				}

				if (!current || dirty & /*options*/ 2 && input0_checked_value !== (input0_checked_value = /*options*/ ctx[1] && /*options*/ ctx[1].disableAllClicks)) {
					prop_dev(input0, "checked", input0_checked_value);
				}

				if (!current || dirty & /*options*/ 2 && input1_checked_value !== (input1_checked_value = /*options*/ ctx[1] && /*options*/ ctx[1].randomizeElements)) {
					prop_dev(input1, "checked", input1_checked_value);
				}
			},
			i: function intro(local) {
				if (current) return;
				transition_in(header.$$.fragment, local);
				current = true;
			},
			o: function outro(local) {
				transition_out(header.$$.fragment, local);
				current = false;
			},
			d: function destroy(detaching) {
				if (detaching) {
					detach_dev(main);
				}

				destroy_component(header);
				mounted = false;
				run_all(dispose);
			}
		};

		dispatch_dev("SvelteRegisterBlock", {
			block,
			id: create_fragment.name,
			type: "component",
			source: "",
			ctx
		});

		return block;
	}

	function instance($$self, $$props, $$invalidate) {
		let { $$slots: slots = {}, $$scope } = $$props;
		validate_slots('Dashboard', slots, []);
		let { showStatus = false } = $$props;
		let { options } = $$props;

		// functions
		const handleOptions = (event, optionId) => {
			const { checked } = event.target;
			$$invalidate(1, options[optionId] = checked, options);
		};

		// Saves options to chrome.storage
		const saveOptions = async () => {
			const { disableAllClicks, randomizeElements } = options;
			await browser.storage.local.set({ disableAllClicks, randomizeElements });
			$$invalidate(0, showStatus = true);

			setTimeout(
				() => {
					$$invalidate(0, showStatus = false);
				},
				3000
			);
		};

		// Restores select box and checkbox state using the preferences
		// stored in chrome.storage.
		const restoreOptions = async () => {
			$$invalidate(1, options = await browser.storage.local.get({
				disableAllClicks: false,
				randomizeElements: false
			}));

			console.log("options", options);
		};

		// Event listeners
		document.addEventListener("DOMContentLoaded", restoreOptions);

		$$self.$$.on_mount.push(function () {
			if (options === undefined && !('options' in $$props || $$self.$$.bound[$$self.$$.props['options']])) {
				console_1.warn("<Dashboard> was created without expected prop 'options'");
			}
		});

		const writable_props = ['showStatus', 'options'];

		Object.keys($$props).forEach(key => {
			if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1.warn(`<Dashboard> was created with unknown prop '${key}'`);
		});

		const click_handler = e => handleOptions(e, "disableAllClicks");
		const click_handler_1 = e => handleOptions(e, "randomizeElements");

		$$self.$$set = $$props => {
			if ('showStatus' in $$props) $$invalidate(0, showStatus = $$props.showStatus);
			if ('options' in $$props) $$invalidate(1, options = $$props.options);
		};

		$$self.$capture_state = () => ({
			browser,
			Header,
			showStatus,
			options,
			handleOptions,
			saveOptions,
			restoreOptions
		});

		$$self.$inject_state = $$props => {
			if ('showStatus' in $$props) $$invalidate(0, showStatus = $$props.showStatus);
			if ('options' in $$props) $$invalidate(1, options = $$props.options);
		};

		if ($$props && "$$inject" in $$props) {
			$$self.$inject_state($$props.$$inject);
		}

		return [
			showStatus,
			options,
			handleOptions,
			saveOptions,
			click_handler,
			click_handler_1
		];
	}

	class Dashboard extends SvelteComponentDev {
		constructor(options) {
			super(options);
			init(this, options, instance, create_fragment, safe_not_equal, { showStatus: 0, options: 1 });

			dispatch_dev("SvelteRegisterComponent", {
				component: this,
				tagName: "Dashboard",
				options,
				id: create_fragment.name
			});
		}

		get showStatus() {
			throw new Error("<Dashboard>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}

		set showStatus(value) {
			throw new Error("<Dashboard>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}

		get options() {
			throw new Error("<Dashboard>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}

		set options(value) {
			throw new Error("<Dashboard>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
		}
	}

	const app = new Dashboard({
	    target: document.body,
	});

	return app;

})();
//# sourceMappingURL=dashboard.js.map
