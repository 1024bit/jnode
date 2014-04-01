/**
 *  A CMD module loader
 *
 *  Usage:
 *  jNode.setup(settings);
 *  jNode.require('uri1, uri2', callbcak);
 */
(function(global) {
    var
    jNode = {},
    defaults = {
        path: {},
        alias: {}
    },
    settings = _extend({}, defaults),

    moduleType = {
        'js': 'script', 'json': 'script',
        'css': 'style',
        'gif': 'image', 'jpg': 'image', 'png': 'image',
        'html': 'document', 'xml': 'document', 'txt': 'document'
    },
    transports = {},
    router = {},
    eventRegistry = {},

    slice = [].slice,
    create = document.createElement,
    head = document.getElementsByTagName('head')[0],
    base = document.getElementsByTagName('base')[0] || head.appendChild(create('base')),
    baseURI = document.baseURI || base.href || document.URL,
    dynamicURIResolveSupported = (_parse('').href !== ''),

    // RegExp
    RE_DEPENDENCIES = /require\s*\(\s*'|"(.+?)'|"\s*\)/gm,
    RE_DELIMITER_COMMA = /,\s*/,
    RE_FILE = /\/(?:[^./]*)(\.\w+)?$/,

    //jNode events
    EVENT_RESOLVE = 'resolve', // When call resolve
    EVENT_DEFINE = 'define', // When call define
    EVENT_BEFORE_DEPENDENCIES_READY = 'beforeDependenciesReady', // Before module's dependencies is ready
    EVENT_READY = 'ready'; // Module is ready

    global.define = define;
    global.require = require;
    global.jNode = jNode;

    // Add default transport
    // You can also refer below structure to add other transports, eg: audio/video, archives, office, adobe etc
    _forEach({ 'script': 'script', 'style': 'link', 'image': 'img', 'document': 'iframe' }, function(element, type) {
        transport(type, function(module) {
            var object = create(element), count = 0;
            return {
                create: function() {
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
                            document.appendChild(object);
                        }
                    }

                    object.onload = object.onerror = object.onreadystatechange = callback;
                }
            };
            function callback() {
                var DOC = (object.tagName.toUpperCase() === 'IFRAME'), IMG = (object.tagName.toUpperCase() === 'IMG');
                if (!object.readyState || /loaded|complete/.test(object.readyState)) {
                    if (!count++) {
                        // 404 error or non-standard CMD module
                        if (DOC)
                            module.exports = object.contentWindow.document.body.innerHTML;
                        else if (IMG)
                            module.exports = object;

                        if (module.status !== 2)
                            module.reject(module);

                        object.onreadystatechange = object.onload = object.onerror = null;
                        if (!IMG) {
                            if (object.parentNode)
                                object.parentNode.removeChild(object);
                            object = null;
                        }
                    }
                }
            }
        });
    });

    /**
     *  A implementing of "Common Module Definition"
     *  https://github.com/cmdjs/specification/blob/master/draft/module.md
     */
    // Take a base URL, and a href URL, and resolve them as a browser would for an anchor tag
    function resolve(uri, baseURI) {
        var a0, a1, orig, i, event, path;
        if (settings.alias[uri]) { // Alias
            uri = settings.alias[uri];
        } else {
            // IE regard '' as a file
            if (uri === '') uri = baseURI;

            // Begin with path
            i = uri.indexOf('/');
            if ((path = settings.path[uri.substring(0, ~i ? i : uri.length)]))
                uri = path + uri.substring(i);

            orig = base.href;
            base.href = baseURI;
            a1 = _parse(uri);
            base.href = orig; // Restore
            // IE always return ":" as the default value
            if (a1.protocol !== ':') { // Absolute uri
                uri = a1.href;
            } else {
                if (!router[baseURI])
                    router[baseURI] = {};

                if (!router[baseURI][uri]) {
                    if (!dynamicURIResolveSupported) { // ~IE7
                        a0 = _parse(baseURI);
                        i = a0.pathname.lastIndexOf('/');
                        a1.href = a0.protocol + '//' + a0.host + a0.pathname.substring(0, ~i ? i : undefined) + a1.pathname;
                    }
                    router[baseURI][uri] = a1.href;
                }
                uri = router[baseURI][uri];
            }
        }
        // Fire "resolve" event, then you can customize the resolved uri
        event = Event(EVENT_RESOLVE);
        jNode.fire(event, uri);
        if (typeof event.result === 'string')
            uri = event.result;

        return uri;
    }

    // Setup jNode
    function setup(k, v) {
        if (typeof k === 'object')
            _extend(settings, k);
        else
            settings[k] = v;
    }

    // Add a module type with supported file ext
    function addType(type, ext) {
        moduleType[ext] = type;
    }

    // Define a module and extract the dependencies
    function define(id, dependencies, factory) {
        var
        cache = Module.instances, alias = {},
        waitings, delayWaitings, module, uri, code, event;

        if (typeof id === 'object') {
            // define({}), define([], factory)
            factory = dependencies || function() {
                return id;
            };
            dependencies = (dependencies && id) || undefined;
            id = undefined;
        } else if (typeof id === 'function') {
            // define(factory)
            factory = id;
            dependencies = undefined;
            id = undefined;
        }

        uri = _getCurrentScript().src;
        if (id) {
            uri = _parse(uri);
            uri = uri.protocol + '//' + uri.host + uri.pathname.replace(RE_FILE, '/' + id + '$1') + uri.search + uri.hash;
            // In fact, a module id is an alias
            alias[id] = uri;
            setup('alias', alias);
        }
        module = cache[uri];
        // Repeated define
        if (module.status === 2) return;

        // Fire "define" event, may be you want to customize the behavior of "define"
        if (!jNode.fire(EVENT_DEFINE, id, dependencies, factory))
            return;
        // factory source code
        code = factory.toString();
        // Dependencies is undefined already
        if (dependencies === undefined) {
            dependencies = [];
            // Fire "beforedependenciesready" event, may be you want to add some alias to "require"
            event = Event(EVENT_BEFORE_DEPENDENCIES_READY);
            jNode.fire(event, code);
            // Extract module dependencies
            while (RE_DEPENDENCIES.exec(code))
                dependencies.push(RegExp.$1);
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
        _when(waitings ? _require(dependencies) : true).always(function() {
            var exports;
            module.status = 3;
            module.statusText = 'INTERACTIVE';
            exports = factory(function() {
                require.apply(module, arguments);
            }, module.exports, module);
            // Which dependencies defer to request at factory runtime
            delayWaitings = dependencies.length - waitings;
            _when(delayWaitings ? _require(dependencies.slice(waitings)) : true).always(function() {
                if (exports) module.exports = exports;
                module.status = 4;
                module.statusText = 'COMPLETE';
                module.resolve(module);
            });

            // Fire "ready" event, then you can depend on this module securely
            jNode.fire(EVENT_READY, module);
        });
    }
    define.cmd = true;

    // Output a module object
    function require(uri) {
        uri = resolve(uri, this.uri);
        if (uri)
            return Module.instances[uri].exports;
        // Or else async
        _require.apply(this, [uri].concat(slice.call(arguments, 1)));
    }

    // Accepts a list of module identifiers and a optional callback function
    jNode.require = require.async = _require;

    // The background "Hero" of jNode.require, require, require.async
    function _require(uri, callback, type) {
        if (typeof uri === 'string')
            uri = uri.split(RE_DELIMITER_COMMA);
        if (typeof type === 'string')
            type = type.split(RE_DELIMITER_COMMA);

        var
        module,
        cache = Module.instances,
        baseuri = this.uri || baseURI;
        promised = _when(function() {
            var deferreds = [];
            _forEach(uri, function(v, i) {
                module = cache((uri[i] = resolve(v, baseuri)));
                deferreds.push(module || _createModule(uri[i], type[i]));
            });
            return deferreds;
        }).always(function() {
            var exports = [];
            if (callback) {
                _forEach(deferreds, function() {
                    exports.push(this.exports);
                });
                callback.apply(this, exports);
            }
        });
        // Runtime dependencies
        if (this instanceof Module) this.dependencies.push(uri);
        return promised;
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
        _extend(this, Deferred().promise());
        Module.instances[uri] = this;
    }
    Module.instances = {};

    // Construct transport for various Require
    function transport(type, structure) {
        // Add or override
        var add = !type.indexOf('+') && (type = type.substring(1));
        if (transports[type]) transports[type] = [];
        transports[type] = (!add) ? [structure] : transports[type].push(structure);
    }

    // Create a module
    function _createModule(uri, type) {
        var
        module = Module({uri: uri}),
        i, pathname, ext, transport;

        if (!type) {
            pathname = _parse(uri).pathname;
            ext = pathname.substring(pathname.lastIndexOf('.') + 1 || pathname.length);
            type = moduleType[ext] || 'script';
        }
        module.type = type;
        module.status = 1;
        module.statusText = 'LOADING';

        for (i in transports[type]) {
            transport = transports[type][i](module);
            transport.create();
        }
        return module;
    }

    /**
     *  jNode event mechanism
     */
    // A simple implementing of jQuery.Event
    function Event(event, props) {
        event = (typeof event === 'string') ? {
            type: event
        }
         : {
            originalEvent: event,
            type: event.type
        };
        _extend(event, props);
        return event;
    }

    // Fire an event
    function fire(event) {
        var
        data = [].slice.call(arguments, 1),
        type, callback, orig, listeners, listener,
        result, defaultPrevented, i;

        // Ensure the event is a new instance
        event = Event(event);
        type = event.type;
        callback = this[type];
        orig = event.originalEvent;
        listeners = eventRegistry[type];
        if (orig) {
            _extend(event, orig);
        }
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
            typeof callback === 'function' &&
            callback.call(this, event) === false ||
            defaultPrevented === true);
    }

    // Register or unregister an event
    // jNode.on(type, data, listener), jNode.off(type, listener) or jNode.off()
    // on can accepts event object?
    _forEach('on off'.split(' '), function(method) {
        jNode[method] = function(type, data, listener) {
            var
            off = (method === 'off'),
            events, types,
            i = 0;

            if (off) {
                if (!arguments.length) {
                    eventRegistry = {};
                }
                listener = data;
            }
            if (typeof type === 'string') {
                types = type.split(' ');
                for (; i < types.length; i++) {
                    type = types[i];
                    if (off) {
                        delete eventRegistry[type];
                    } else {
                        eventRegistry[type] = (eventRegistry[type] || []).push({
                            data: data,
                            handler: handler
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
        _currentScript = document.currentScript,
        // Return script object based off of src
        getScriptFromURL = function(url) {
            var i = 0, script;

            for (; i < scripts.length; i++) {
                script = scripts[i];
                if (script.src === url || (script.readyState && script.readyState === 'interactive'))
                    return script;
            }
            return undefined;
        };
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
                    stack = stack.substring(index) + at.length);
                stack = stack.substring(0, stack.indexOf(':'));
            }
            
            return getScriptFromURL(stack);
        };
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
        callbacks = {}, proto, 
        map = {
            "resolve" : "done",
            "reject" : "fail"
        },
        state = 'pending', // States: pending, resolved, rejected
        event, trigger;

        for (trigger in map) {
            event = map[trigger];
            // Events: done, fail
            deferred[event] = promised[event] = function (callback) {
                return _addCallback(event, callback);
            };
            //  Trigger: resolve, reject
            deferred[trigger] = function () {
                var
                pending = (deferred.state() === 'pending'),
                reject = (trigger === 'reject'),
                resolve = !reject,
                deferreds = deferred.deferreds,
                always, queues, fn;

                // For Deferreds and Deferred
                if (!pending)
                    return;

                if (deferreds) {
                    var key;
                    for (key in deferreds) {
                        if (deferreds[key].state() !== 'pending')
                            continue;
                        pending = true;
                    }
                    if (resolve && pending)
                        return;
                    if (reject && pending) {
                        queues = callbacks.reject;
                    }
                }
                if (!queues) {
                    queues = callbacks[trigger].concat(callbacks.always);
                    always = true;
                }

                if (!queues.length)
                    return;

                callbacks[trigger] = [];
                always && (callbacks.always = []);
                while ((fn = queues.shift())) {
                    fn.apply(promised, arguments);
                }

                // State: resolved or rejected
                if (!deferreds || always) {
                    state = trigger + (reject ? 'ed' : 'd');
                }
            }
        }
        proto = {
            always: function (callback) { return _addCallback('always', callback); }, 
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

        if (deferred.deferreds) {
            var
            args = [],
            _callback = function (trigger) {
                return function () {
                    args.push(arguments.length > 1 ? arguments : arguments[0]);
                    deferred[trigger].apply(deferred, args);
                }
            },
            _done = _callback('resolve'),
            _fail = _callback('reject');

            _forEach(deferred.deferreds, function () {
                if (!(this instanceof _Deferred))
                    return _done(this);

                this.done(_done).fail(_fail);
                if (this.state() === 'resolved')
                    this.resolve();
                if (this.state() === 'rejected')
                    this.reject();
            });
        }

        function promise(target) {
            return target ? target.promise() : promised;
        }

        // Add callbacks for done, fail, always
        function _addCallback(event, callback) {
            if (typeof callback !== 'function')
                return;
            callbacks[event] = (callbacks[event] || []).push(callback);
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
        }).promise();
    }
    
    // A simple implementing of jQuery.extend
    function _extend(target) {
        var
        sources = slice.call(arguments, 1),
        source, k, v, i;
        
        for (i = 0; i < sources.length; i++) {
            source = sources[i];
            for (k in source) {
                v = source[k];
                if (typeof v === 'object' && v !== null) {
                    if (typeof target[k] === 'object') {
                        _extend(target[k], v);
                    } else {
                        target[k] = _extend({}, v);
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
        for (var k in hash)
            fn.call(hash[k], hash[k], k, hash);
    }
    
    // Parse a URL and return its components
    function _parse(uri) {
        var a = create('a'), result;
        a.href = uri;
        // In IE, without '/' prefix for A element's pathname property
        if (!a.pathname.indexOf('/')) a.pathname = '/' + a.pathname;
        result = { href: a.href, protocol: a.protocol, host: a.host, pathname: a.pathname, search: a.search, hash: a.hash };
        a = null;
        return result;     
    }    

    /**
     *  API
     */
    jNode.cache = Module.instances;
    jNode.setup = setup;
    jNode.addType = addType;
    jNode.transport = transport;
    jNode.Event = Event;
    jNode.fire = fire;
    jNode.resolve = resolve;
}(this));
