/**
 *  jNode, a CMD and AMD compatible module loader
 *
 *  Usage:
 *  jNode.set({paths: {}, alias: {}});
 *  jNode.require('uri1, uri2', callbcak);
 *  
 *  Copyright(c) 2014 vip.com
 *  Copyright(c) 2014 Cherish Peng<cherish.peng@vipshop.com>
 *  MIT Licensed   
 */
(function(global) {
    var
    jNode = {},
    defaults = {paths: {}, alias: {}, deps: [], vars: {}},
    slice = [].slice,
    toString = Object.prototype.toString, 
    settings = _extend({}, defaults),
    moduleType = {
        'js': 'script', 
        'css': 'style',
        'gif': 'image', 'jpg': 'image', 'png': 'image',
        'json': 'document', 'html': 'document', 'xml': 'document', 'txt': 'document'
    },
    transports = {},
    router = {},
	vars = {}, 
	deps = {}, 
    eventRegistry = {}, 
    rules = {require: ''}, 

    head = document.getElementsByTagName('head')[0],
    base = document.getElementsByTagName('base')[0] || head.appendChild(document.createElement('base')),
    baseURI = document.baseURI || base.href || document.URL,
    dynamicURIResolveSupported = (_parse('').href !== ''),

    // RegExp
    RE_DEPENDENCIES, 
    RE_DEPENDENCIES_BODY = '\\s*\\(\\s*(?:\'|\")([^+]+?)(?:\'|\")', 
    RE_DELIMITER_COMMA = /,\s*/,
    RE_TRIM = /^\s*|\s*$/gm, 
    RE_LEADING_SLASH = /^\//,
	RE_VARS = /\{(.+)\}/g, 

    //jNode events
    EVENT_MODULE_RESOLVE = 'moduleresolve', // When call resolve
    EVENT_MODULE_DEFINE = 'moduledefine', // When call define
    EVENT_BEFORE_MODULE_PREFETCH = 'beforemoduleprefetch', // Before module's dependencies is ready
    EVENT_MODULE_EXECUTE = 'moduleexecute', // Execute module
    EVENT_MODULE_READY = 'moduleready'; // Module is ready

    global.define = define;
    global.require = require;
    global.jNode = jNode;
    
    addRule('require');

	// Parse {var} in url use the vars setting
    function _parseVars(match) {
		return vars[match] 
			|| (vars[match] = match.replace(RE_VARS, function(m, m1) { return settings.vars[m1]; }));	
	}
    
	// Set jNode setting
    function _set(k, v) {
        var _deps = [];
		if ('object' === typeof k) {
            _extend(settings, k);
			if (k.deps) _deps = k.deps;
		} else if ('object' === typeof v && 'object' === typeof settings[k]) {
            settings[k] = _extend(settings[k], v);
			if (k === 'deps')  _deps = v;
		} else { 
            settings[k] = v;
		}
			
		// Memo
		_forEach(_deps, function(v, i) {
			deps[resolve(v)] = i;
		});
    }    
    
    // Get jNode setting
    function _get(k) {
        return settings[k];
    }

    // Add a module type with supported file ext
    function addType(type, ext) {
        moduleType[ext] = type;
    }
    
    // Add a rule for extracting module dependencies
    function addRule(name, rule) {
        rule = rule || '';
        var name, names = [];
        rules[name] = rule;
        for (name in rules) { names.push(name); }
        name = '(' + names.join('|') + ')';
        RE_DEPENDENCIES = new RegExp(name + RE_DEPENDENCIES_BODY, 'mg');        
    }
    
    // Add default transport
    // You can also refer below structure to add other transports, eg: audio, video, archives, office, adobe etc
    _forEach({ 'script': 'script', 'style': 'link', 'image': 'img', 'document': 'iframe' }, function(element, type) {
        transport(type, function(module) {
            var object = document.createElement(element);
            return {
                send: function() {
                    if (type === 'style') {
                        object.rel = 'stylesheet';
                        object.href = module.uri;
                        head.appendChild(object);
                    } else {
                        object.src = module.uri;
                        if (type === 'script') {
                            object.async = true;
                            head.appendChild(object);
                        } else if (type === 'document') {
                            object.style.display = 'none';
                            document.body.appendChild(object);
                        }
                    }

                    object.onload = object.onerror = object.onreadystatechange = callback;
                }
            };
            function callback() {
                var 
                IFRAME = (object.tagName.toUpperCase() === 'IFRAME'), 
                IMG = (object.tagName.toUpperCase() === 'IMG'), 
                JSON = ~object.src.indexOf('.json');

                if (!object.readyState || /loaded|complete/.test(object.readyState)) {
                    if (IFRAME) {
                        var body = object.contentWindow.document.body;
                        res = body.innerText || body.textContent;
                        res.replace(RE_TRIM, '');
                        module.exports = JSON ? eval('(' + res + ')') : res;
                    } else if (IMG)
                        module.exports = object;
                    // 404 error, Non-Standard CMD module or Non-JS module
                    if (module.status === 1) {
                        module.status = 4;
                        module.statusText = 'COMPLETE';
                        module.resolve(module);
                    }

                    object.onreadystatechange = object.onload = object.onerror = null;
                    if (!IMG) { // Append img to document is not necessary
                        if (object.parentNode)
                            object.parentNode.removeChild(object);
                        object = null;
                    }
                }
            }
        });
    });

    /**
     *  Implementation
     */
    // Take a base URL, and a href URL, and resolve them as a browser would for an anchor tag
    function resolve(uri, baseUri, type) {
		uri = _parseVars(uri);
        baseUri = baseUri || baseURI;
        var a0, a1, orig, i, event, path, ext;
        if (settings.alias[uri]) { // Alias
            uri = settings.alias[uri];
        } 
		// IE regard '' as a file
		if (uri === '') uri = baseUri;

		// Begin with path
		i = uri.indexOf('/');
		if ((path = settings.paths[uri.substring(0, ~i ? i : uri.length)]))
			uri = path + uri.substring(i);

		orig = base.href;
		base.href = baseUri; // A trick for getting a URL's component
		a1 = _parse(uri);
		base.href = orig; // Restore
		
		// No-Search(dynamic URL) and No-Ext
		// Support filename like this, xxx[.xxx, ...].js
		ext = a1.pathname.substring(a1.pathname.lastIndexOf('.') + 1 || a1.pathname.length);
		if (!a1.search && (!ext || (!type && !moduleType[ext]))) {
			a1.pathname += '.js';
			a1.href += '.js';
		}
		
		// IE always return ":" as the default value
		if (~a1.href.indexOf('//')) { // Absolute uri
			uri = a1.href;
		} else {
			if (!router[baseUri])
				router[baseUri] = {};

			if (!router[baseUri][uri]) {
				if (!dynamicURIResolveSupported) { // ~IE7
					a0 = _parse(baseUri);
					i = a0.pathname.lastIndexOf('/');
					a1.href = a0.protocol + '//' + a0.host + a0.pathname.substring(0, ~i ? i : undefined) + a1.pathname;
				}
				router[baseUri][uri] = a1.href;
			}
			uri = router[baseUri][uri];
		}
        
        // Fire "resolve" event, then you can customize the resolved uri
        event = Event(EVENT_MODULE_RESOLVE);
        fire.call(null, event, uri); // It's not recommened to use the jNode.fire is exported to external
        if (typeof event.result === 'string')
            uri = event.result;

        return uri;
    }

    // Define a module and extract the dependencies
    function define(id, dependencies, factory) {
        var
        cache = Module.instances, alias = {},
        waitings, delayWaitings, module, uri, code, event, rule, match;

        if ('object' === typeof id) {
            // define({}), define([], factory)
            factory = dependencies || function() {
                return id;
            };
            dependencies = (dependencies && id) || undefined;
            id = undefined;
        } else if ('function' === typeof id) {
            // define(factory)
            factory = id;
            dependencies = undefined;
            id = undefined;
        } else if ('function' === typeof dependencies) {
			// define(id, factory)
			factory = dependencies;
			dependencies = undefined;	
		}

        uri = _getCurrentScript().src;
        if (id) {
            uri = _parse(uri);
            uri = uri.protocol + '//' + uri.host + uri.pathname.substring(0, uri.pathname.lastIndexOf('/') + 1) + id.replace(RE_LEADING_SLASH, '') + '.js' + uri.search + uri.hash;
            // In fact, a module id is an alias
            alias[id] = uri;
            _set('alias', alias);
        }
        module = cache[uri] || Module({uri: uri});
        // Repeated define
        if (module.status === 2) return;

        // Fire "define" event, may be you want to customize the behavior of "define"
        // window.fn = function() { console.log(1); };
        // (function(fn){ this[fn](); }).call(null, ['fn']) will output "1" in Chrome
        if (!fire.call({}, EVENT_MODULE_DEFINE, id, dependencies, factory))
            return;
        // factory source code
        code = factory.toString();
        // Dependencies is undefined
        if (undefined === dependencies) {
			dependencies = [];
            // Fire "beforemoduledependenciesready" event, may be you want to add some alias to "require"
            event = Event(EVENT_BEFORE_MODULE_PREFETCH);
            fire.call(null, event, code);
            // Extract module dependencies
            while (RE_DEPENDENCIES.exec(code)) {
                rule = rules[RegExp.$1];
				match = ('function' === typeof rule) ? rule(RegExp.$2) : RegExp.$2;
                dependencies.push(_parseVars(match));
            }
            if (event.result) {
                dependencies = dependencies.concat(event.result);
            }
        }
        module.status = 2;
        module.statusText = 'LOADED';
        module.id = id;
        // Dependencies is passed as reference
        module.dependencies = dependencies;

        // Require dependencies, those are concurrent requests
        // Ignore the failed Require
        waitings = dependencies.length;
        _when(waitings ? _require.call(module, dependencies) : true).always(function() {
            var exports;
            module.status = 3;
            module.statusText = 'INTERACTIVE';
            
            exports = factory(function() {
                return require.apply(module, arguments);
            }, module.exports, module);
            
            // Fire "moduleexecute" event
            fire.call(null, EVENT_MODULE_EXECUTE, module, exports || module.exports);           

            // Which dependencies defer to request at factory runtime
            delayWaitings = dependencies.length - waitings;
            _when(delayWaitings ? _require.call(module, dependencies.slice(waitings)) : true).always(function() {
                if (exports) module.exports = exports;
                module.status = 4;
                module.statusText = 'COMPLETE';
                module.resolve(module);
            });

            // Fire "ready" event, then you can depend on this module securely
            fire.call(null, EVENT_MODULE_READY, module);
        });
    }
     
    // https://github.com/cmdjs/specification/blob/master/draft/module.md
    define.cmd = {amd: true};
    // https://github.com/amdjs/amdjs-api/blob/master/AMD.md#defineamd-property-
    define.amd = {cmd: true};

    // Output a module object
    function require(uri, callback, type) {
        uri = resolve(uri, this.uri, type);
        var module = Module.instances[uri];       
        if (module && module.status === 4) {
            // For sync callback
            if (callback) { callback.call(module, module.exports); }
            return module.exports;
        } 
        
        // Runtime dependencies
        if ((this instanceof Module) && !module) this.dependencies = this.dependencies.concat(uri);        
        // Or else async
        return _require.apply(this, [uri].concat(slice.call(arguments, 1)));
    }

    // Accepts a list of module identifiers and a optional callback function
    jNode.require = require.async = _require;

    // The background "Hero" of jNode.require, require, require.async
    function _require(uri, callback, type) {
        type = type || [];
        if (typeof uri === 'string')
            uri = uri.split(RE_DELIMITER_COMMA);
        // Ensure all dependencies are prefetched
        if (typeof type === 'string')
            type = type.split(RE_DELIMITER_COMMA);
        
        
        var
        cache = Module.instances,
        baseuri = this.uri, 
        deferreds = [];
        deferred = _when(function() {
			return iterator.call(settings.deps, true);	
		}).always(function() {
			_when(function() {
				return iterator.call(uri);
			}).always(function() {
				var exports = [];
				if (callback) {
					_forEach(slice.call(arguments, settings.deps.length), function() {
						exports.push(this.exports);
					});
					callback.apply(this, exports);
				}
			});		
		})
        return deferred;
		
		function iterator(isDep) {
			var context = this;
			_forEach(context, function(v, i) {
				// Deps's base is document's baseURI
				context[i] = resolve(v, isDep ? baseURI : baseuri);
				// Filter out url in settings.deps
				if (isDep && deps[baseuri] !== undefined) return;
				var module = cache[context[i]];
				deferreds.push(module || _createModule(context[i]));
			});

			return deferreds.length ? deferreds : [true];
		}
    }

    /**
     *  Module class, extends deferred class
     *  Status:
     *  0: UNINITIALIZED 1: LOADING 2: LOADED 3: INTERACTIVE 4: COMPLETE
     */
    function Module(module) {
        if (!(this instanceof Module))
            return new Module(module);
        this.id = module.id;
        this.uri = module.uri;
        this.status = 0;
        this.statusText = 'UNINITIALIZED';
        this.dependencies = module.dependencies || [];
        this.exports = module.exports || {};
        _extend(this, _Deferred()); // It's very important to copy a deferred
        Module.instances[this.uri] = this;
    }
    Module.instances = {};

    // Construct transport for various Require
    function transport(type, structure) {
        // Add or override
        var add = !type.indexOf('+') && (type = type.substring(1));
        if (!transports[type]) transports[type] = [];
        transports[type] = (!add) ? [structure] : transports[type].push(structure);
    }

    // Create a module
    function _createModule(uri, type) {
        var module, i = 0, pathname, ext, transport;
        
        if (!type) {
            pathname = _parse(uri).pathname;
            ext = pathname.substring(pathname.lastIndexOf('.') + 1 || pathname.length);
            type = moduleType[ext];
        }
        module = Module({uri: uri});
        module.type = type;
        module.status = 1;
        module.statusText = 'LOADING';

        for (; i < transports[type].length; i++) {
            transport = transports[type][i](module);
            transport.send();
        }
        return module;
    }

    /**
     *  jNode utilities
     *  Because thoes utilities don't exposed to external environment,
     *  so we assume all arguments are security as we expected
     */
    // A simple implementing of jQuery.Deferred
    // * Deferreds's always is diff from Deferred's always, until all the Deferreds are resolved or rejected, then execute always callbacks
    function _Deferred(constructor) {
        if (!(this instanceof _Deferred))
            return new _Deferred(constructor);

        var
        deferred = this, promised = {}, 
        callbacks = {"resolve": [], "reject": [], "always": []}, proto, 
        map = {"resolve": "done", "reject": "fail"},
        state = 'pending', // States: pending, resolved, rejected
        event, trigger, addDoneFail;

        for (trigger in map) {
            event = map[trigger];
            _(trigger);
            function _(trigger) {
                // Events: done, fail
                deferred[event] = promised[event] = function (callback) {
                    _addCallback.call(this, trigger, callback);
                    return this;
                };
                //  Trigger: resolve, reject
                deferred[trigger] = function() {
                    var
                    reject = (trigger === 'reject'),
                    resolve = !reject,
                    deferreds = this.deferreds,
                    pending, always, queues, fn, i = 0;

                    if (deferreds) {
                        for (; i < deferreds.length; i++) {
                            if (!deferreds[i].state || deferreds[i].state() !== 'pending')
                                continue;
                            pending = true;
                        }
                        if (resolve && pending) {
                            return;
                        }
                        if (reject && pending) {
                            queues = callbacks.reject;
                        }
                    }

                    if (!deferreds || !pending) {
                        always = true;
                        queues = callbacks[trigger].concat(callbacks.always);
                    }
                    // State: resolved or rejected
                    if (!deferreds || always) {
                        state = trigger + (reject ? 'ed' : 'd');
                    }                     

                    callbacks[trigger] = [];
                    always && (callbacks.always = []);
                    while ((fn = queues.shift())) {
                        fn.apply(this, arguments);
                    }
                };
            }
        }
        proto = {
            always: function (callback) { 
                _addCallback.call(this, 'always', callback); 
                return this;
            }, 
            state: function () { return state; }
        };
        _extend(deferred, proto);
        _extend(promised, proto);
        
        // deferred.state = 'pending';
        deferred.promise = promised.promise = promise;
        // Deferred constructor
        if (constructor) {
            constructor.call(deferred, deferred);
        }

        function promise(target) {
            return target ? target.promise() : promised;
        }
        
        // Add callbacks for resolve, reject, always
        function _addCallback(trigger, callback) {
            var deferred = this;
            if (typeof callback !== 'function')
                return;
            callbacks[trigger].push(callback);

            if (deferred.deferreds) {
                var 
                args = {"resolve": [], "reject": []},
                _callback = function (trigger, i) {
                    return function () {
                        args[trigger][i] = (arguments.length > 1 ? slice.call(arguments) : arguments[0]);
                        deferred[trigger].apply(deferred, args[trigger]);
                    }
                };    
                _forEach(deferred.deferreds, function() {
                    var 
                    i = arguments[1], 
                    _done = _callback('resolve', i), 
                    _fail = _callback('reject', i);

                    if (!this.state)
                        return _done(this);
                        
                    // Reflect single deferred's state to deferreds
                    // For chain call such as deferred.always(fn).always(fn)...
                    if (!addDoneFail) {
                        this.done(_done).fail(_fail);
                    }
                    
                    // Run right now!
                    if (this.state() === 'resolved') {
                        this.resolve(this);
                    }
                    if (this.state() === 'rejected') {
                        this.reject(this);
                    }            
                }); 
                addDoneFail = true;             
            }
        }
    }
    
    // A simple implementing of jQuery.when
    function _when(deferreds) {
        if (typeof deferreds === 'function') {
            // _when(function () {return [d1, d2, ...]})
            deferreds = deferreds();
        } else {
            // _when(d1, d2, ...)
            deferreds = slice.call(arguments, 0);
        }

        return _Deferred(function (deferred) {
            deferred.deferreds = deferreds;
        });
    }
    
    /**
     *  jNode event mechanism
     */
    // A simple implementing of jQuery.Event
    function Event(event, props) {
        event = (typeof event === 'string') ? {
            type: event
        } : {
            originalEvent: event,
            type: event.type
        };
        _extend(event, props);
        return event;
    }

    // Fire an event
    function fire(event) {
        // Ensure the event is a new instance
        event = Event(event);

        var
        data = slice.call(arguments, 1),
        listener, result, defaultPrevented, i, 
        type = event.type,
        callback = this[type],
        orig = event.originalEvent,
        listeners = eventRegistry[type] || [];
        if (orig) _extend(event, orig);

        for (i = 0; i < listeners.length; i++) {
            listener = listeners[i];
            event.data = listener.data;
            if ((result = listener.handler.apply(this, [event].concat(data))) === false) {
                defaultPrevented = true;
            }
            if (result !== undefined) {
                event.result = result;
                orig && (orig.result = result);
            }
        }

        return !(
            ((typeof callback === 'function') &&
            (callback.call(this, event) === false)) ||
            defaultPrevented === true);
    }

    // Register or unregister an event
    // jNode.on(type, data, listener), jNode.off(type, listener) or jNode.off()
    // on can accepts event object?
    _forEach('on off'.split(' '), function(method) {
        jNode[method] = function(type, data, listener) {
            if ('function' === typeof data) {
                listener = data;
                data = undefined;
            }
            var
            off = (method === 'off'),
            events, types,
            i = 0;

            if (off) {
                // if (!arguments.length) // Prevent from removing all events of ill-considered action
                    // eventRegistry = {};
                listener = data;
            }
            if (typeof type === 'string') {
                types = type.split(' ');
                for (; i < types.length; i++) {
                    type = types[i];
                    if (off) 
                        delete eventRegistry[type]; 
                    else {
                        if (!eventRegistry[type]) eventRegistry[type] = [];
                        eventRegistry[type].push({
                            data: data,
                            handler: listener
                        });
                    }
                }
            } else {
                events = type;
                for (type in events)
                    jNode[method](type, data, listener);
            }
            return this;
        };
    });

    // Returns the <script> element whose script is currently being processed
    // https://gist.github.com/6228063.git
    function _getCurrentScript() {
        // document.currentScript polyfill + improvements
        var
        // Only for head
        scripts = head.getElementsByTagName('script'),
        _currentScript = document.currentScript;

        return actualScript();
        
        // Return script object based off of src
        function getScriptFromURL(url) {
            var i = 0, script;

            for (; i < scripts.length; i++) {
                script = scripts[i];
                if (script.src === url || (script.readyState && script.readyState === 'interactive'))
                    return script;
            }
            return undefined;
        }
        function actualScript() {
            if (_currentScript)
                return _currentScript;
            var stack, at, index;

            try {
                omgwtf; // Oh my god! What the fuck!
            } catch (e) {
                /**
                 * e.stack last line:
                 * chrome: at src:line:number
                 * firefox: @src:line
                 * opera: @src:line
                 * IE10: at Global code (src:line:number)
                 */
                stack = e.stack;
            }
            if (stack) {
                at = stack.indexOf(' at ') !== -1 ? ' at ' : '@';
                index = stack.indexOf(at);
                while (index !== -1)
                    stack = stack.substring(index) + at.length;
                stack = stack.substring(0, stack.indexOf(':'));
            }
            return getScriptFromURL(stack);
        }
    }  
    
    // A simple implementing of jQuery.extend
    function _extend(target) {
        var
        sources = slice.call(arguments, 1),
        source, k, v, i, typeto, typefrom;
        
        for (i = 0; i < sources.length; i++) {
            source = sources[i];
            for (k in source) {
                v = source[k];
                typeto = toString.call(v);
                typefrom = toString.call(target[k]);
                if ('object' === typeof v) {
                    if ('object' === typeof target[k]) {
                        if (typeto === typefrom) {
                            _extend(target[k], v);
                        } 
                    } 
                    if (typeto !== typefrom) {
                        target[k] = _extend((typeto === '[object Array]' ? [] : {}), v);
                    }
                } else {
                    target[k] = v;
                }
            }
        }
        return target;
    }
    
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
    function _forEach(hash, fn) {
		var i = 0, k;
	    if (hash.length === undefined) 
			for (k in hash)
				fn.call(hash[k], hash[k], k, hash);
		else 
			for (; i < hash.length; i++) 
				fn.call(hash[i], hash[i], i, hash);
    }
    
    // Parse a URL and return its components
    function _parse(uri) {
        var a = document.createElement('a'), leadslash, result;
        a.href = uri;
        // In IE, without `/` prefix for `A` element's Only-Readable pathname property
        leadslash = (a.pathname.indexOf('/') !== 0);
        result = { href: a.href, protocol: a.protocol, host: a.host, pathname: (leadslash ? ('/' + a.pathname) : a.pathname), search: a.search, hash: a.hash };
        a = null;
        return result;
    }    
	
    /**
     *  API
     */
    jNode.cache = Module.instances;
    jNode.set = _set;
    jNode.get = _get;
    jNode.addType = addType;
    jNode.addRule = addRule;
    jNode.transport = transport;
    jNode.Event = Event;
    jNode.fire = fire;
    jNode.resolve = resolve;
}(this));