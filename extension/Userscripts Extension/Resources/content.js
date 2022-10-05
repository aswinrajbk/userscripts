// code received from background page will be stored in this variable
// code referenced again when strict CSPs block initial injection attempt
let data;
// determines whether strict csp injection has already run (JS only)
let cspFallbackAttempted = false;
// save reference to window's browser object
const browser = window.browser;
// GM APIs
const apis = {
    closeTab(tabId) {
        return new Promise(resolve => {
            const message = {
                name: "API_CLOSE_TAB",
                tabId: tabId
            };
            browser.runtime.sendMessage(message, response => resolve(response));
        });
    },
    openInTab(url, openInBackground = false) {
        if (!url) return console.error("openInTab missing url arg");
        return new Promise(resolve => {
            const message = {
                name: "API_OPEN_TAB",
                url: url,
                active: !openInBackground
            };
            browser.runtime.sendMessage(message, response => resolve(response));
        });
    },
    setValue(key, value) {
        if (!key || !value) {
            console.error("setValue missing key or value args");
            return;
        }
        return new Promise(resolve => {
            const message = {
                name: "API_SET_VALUE",
                key: key,
                value: value,
                filename: this.US_filename
            };
            browser.runtime.sendMessage(message, response => resolve(response));
        });
    },
    getValue(key, defaultValue) {
        if (!key) return console.error("getValue missing key arg");
        return new Promise(resolve => {
            const uuid = Math.random().toString(36).substring(2, 8);
            const message = {
                name: "API_GET_VALUE",
                key: key,
                defaultValue: defaultValue,
                uuid: uuid,
                filename: this.US_filename
            };
            browser.runtime.sendMessage(message, response => {
                const undef = response === `undefined--${uuid}`;
                resolve(undef ? undefined : response);
            });
        });
    },
    listValues() {
        return new Promise(resolve => {
            const message = {
                name: "API_LIST_VALUES",
                filename: this.US_filename
            };
            browser.runtime.sendMessage(message, response => resolve(response));
        });
    },
    deleteValue(key) {
        if (!key) return console.error("deleteValue missing key arg");
        return new Promise(resolve => {
            const message = {
                name: "API_DELETE_VALUE",
                key: key,
                filename: this.US_filename
            };
            browser.runtime.sendMessage(message, response => resolve(response));
        });
    },
    addStyle(css) {
        if (!css) return console.error("addStyle missing css arg");
        return new Promise(resolve => {
            const message = {
                name: "API_ADD_STYLE",
                css: css
            };
            browser.runtime.sendMessage(message, response => resolve(response));
        });
    },
    getTab() {
        return new Promise(resolve => {
            const message = {name: "API_GET_TAB"};
            browser.runtime.sendMessage(message, response => {
                resolve(response);
            });
        });
    },
    saveTab(tab) {
        return new Promise(resolve => {
            const message = {
                name: "API_SAVE_TAB",
                tab: tab
            };
            browser.runtime.sendMessage(message, response => {
                resolve(response);
            });
        });
    },
    setClipboard(data, type) {
        return new Promise(resolve => {
            const message = {
                name: "API_SET_CLIPBOARD",
                data: data,
                type: type
            };
            browser.runtime.sendMessage(message, response => {
                resolve(response);
            });
        });
    }
};
// remote window's browser object
delete window.browser;

function processJS(userscript) {
    const runAt = userscript.scriptObject["run-at"];
    if (runAt === "document-start") {
        injectJS(userscript);
    } else if (runAt === "document-end") {
        if (document.readyState !== "loading") {
            injectJS(userscript);
        } else {
            document.addEventListener("DOMContentLoaded", () => {
                injectJS(userscript);
            });
        }
    } else if (runAt === "document-idle") {
        if (document.readyState === "complete") {
            injectJS(userscript);
        } else {
            document.addEventListener("readystatechange", () => {
                if (document.readyState === "complete") {
                    injectJS(userscript);
                }
            });
        }
    }
}

function wrapCode(preCode, code, filename) {
    return `
        (function() {
            "use strict";
            ${preCode}
            (function() {
                const US_filename = "${filename}";
                const apis = undefined;
                const browser = undefined;
                // userscript code below
                ${code}
                //# sourceURL=${filename.replace(/\s/g, "-")}
            })();
        })();
    `;
}

function injectJS(userscript) {
    const filename = userscript.scriptObject.filename;
    const code = wrapCode(userscript.preCode, userscript.code, filename);
    const name = userscript.scriptObject.name;
    let injectInto = userscript.scriptObject["inject-into"];
    // change scope to content since strict CSP event detected
    if (injectInto === "auto"
        && (userscript.fallback || cspFallbackAttempted)
    ) {
        injectInto = "content";
        console.warn(`Attempting fallback injection for ${name}`);
    } else {
        console.info(`Injecting ${name} %c(js)`, "color: #fff600");
    }
    if (injectInto !== "content") {
        const tag = document.createElement("script");
        tag.textContent = code;
        document.head.appendChild(tag);
    } else {
        try {
            return Function(code)();
        } catch (error) {
            console.error(`${filename} error`, error);
        }
    }
}

function cspFallback(e) {
    // if a security policy violation event has occurred
    // and the directive is script-src or script-src-elem
    // it's fair to assume that there is a strict CSP for javascript
    // and that injection was blocked for all userscripts
    // when any script-src violation is detected, re-attempt injection
    if (
        e.effectiveDirective === "script-src"
        || e.effectiveDirective === "script-src-elem"
    ) {
        // get all "auto" code
        // since other code can trigger a security policy violation event
        // make sure data var is not undefined before attempting fallback
        if (!data || cspFallbackAttempted) return;
        // update global that tracks security policy violations
        cspFallbackAttempted = 1;
        // for all userscripts with @inject-into: auto, attempt re-injection
        for (let i = 0; i < data.files.js.length; i++) {
            const userscript = data.files.js[i];
            if (userscript.scriptObject["inject-into"] !== "auto") continue;
            userscript.fallback = 1;
            processJS(userscript);
        }
    }
}

browser.runtime.sendMessage({name: "REQ_USERSCRIPTS"}, response => {
    // abort injection if errors detected
    if (!response || response.error) {
        console.error(response?.error || "REQ_USERSCRIPTS returned undefined");
        return;
    }
    // save response locally in case CSP events occur
    data = response;
    // loop through each userscript and prepare for processing
    for (let i = 0; i < data.files.js.length; i++) {
        const userscript = data.files.js[i];
        userscript.preCode = "";
        // pass references to the api methods as needed
        const gmMethods = [];
        const filename = userscript.scriptObject.filename;
        const grants = userscript.scriptObject.grant;
        const injectInto = userscript.scriptObject["inject-into"];
        // create GM.info object
        const scriptData = {
            "script": userscript.scriptObject,
            "scriptHandler": data.scriptHandler,
            "scriptHandlerVersion": data.scriptHandlerVersion,
            "scriptMetaStr": userscript.scriptMetaStr
        };
        // all userscripts get access to GM.info
        gmMethods.push("info: GM_info");
        // if @grant explicitly set to none, empty grants array
        if (grants.includes("none")) grants.length = 0;
        // @grant values exist for page scoped userscript
        if (grants.length && injectInto === "page") {
            // remove grants
            grants.length = 0;
            // log warning
            console.warn(`${filename} @grant values removed due to @inject-into value: ${injectInto} - https://github.com/quoid/userscripts/issues/265#issuecomment-1213462394`);
        }
        // @grant exist for auto scoped userscript
        if (grants.length && injectInto === "auto") {
            // change scope
            userscript.scriptObject["inject-into"] = "content";
            // log warning
            console.warn(`${filename} @inject-into value set to 'content' due to @grant values: ${grants} - https://github.com/quoid/userscripts/issues/265#issuecomment-1213462394`);
        }
        // loop through each userscript @grant value, add methods as needed
        for (let j = 0; j < grants.length; j++) {
            const grant = grants[j];
            const method = grant.split(".")[1] || grant.split(".")[0];
            // ensure API method exists in apis object
            if (!Object.keys(apis).includes(method)) continue;
            // create the method string to be pushed to methods array
            let methodStr = `${method}: apis.${method}`;
            // add require variables to specific methods
            switch (method) {
                case "getValues":
                case "setValues":
                case "deleteValue":
                case "listValues":
                    methodStr += `.bind({"US_filename": "${filename}"})`;
                    break;
                case "GM.info":
                case "GM_info":
                    continue;
                case "GM_xmlhttpRequest":
                    userscript.preCode += "const GM_xmlhttpRequest = apis.xhr;";
                    continue;
            }
            gmMethods.push(methodStr);
        }
        // add GM.info
        userscript.preCode += `const GM_info = ${JSON.stringify(scriptData)};`;
        // add other included GM API methods
        userscript.preCode += `const GM = {${gmMethods.join(",")}};`;
        // process file for injection
        processJS(userscript);
    }
});
// listens for messages from background, popup, etc...
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const name = request.name;
    if (
        name === "USERSCRIPT_INSTALL_00"
        || name === "USERSCRIPT_INSTALL_01"
        || name === "USERSCRIPT_INSTALL_02"
    ) {
        // only respond to top frame messages
        if (window !== window.top) return;
        const types = [
            "text/plain",
            "application/ecmascript",
            "application/javascript",
            "text/ecmascript",
            "text/javascript"
        ];
        if (
            !document.contentType
            || types.indexOf(document.contentType) === -1
            || !document.querySelector("pre")
        ) {
            sendResponse({invalid: true});
        } else {
            const message = {
                name: name,
                content:
                document.querySelector("pre").innerText
            };
            browser.runtime.sendMessage(message, response => {
                sendResponse(response);
            });
            return true;
        }
    } else if (name === "CONTEXT_RUN") {
        // from bg script when context-menu item is clicked
        // double check to ensure context-menu scripts only run in top windows
        if (window !== window.top) return;

        // loop through context-menu scripts saved to data object and find match
        // if no match found, nothing will execute and error will log
        const filename = request.menuItemId;
        for (let i = 0; i < data.files.menu.length; i++) {
            const item = data.files.menu[i];
            if (item.scriptObject.filename === filename) {
                console.info(`Injecting ${filename} %c(js)`, "color: #fff600");
                sendResponse({code: item.code});
                return;
            }
        }
        console.error(`Couldn't find ${filename} code!`);
    }
});
// listen for CSP violations
document.addEventListener("securitypolicyviolation", cspFallback);
