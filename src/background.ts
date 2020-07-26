type MessageSender = chrome.runtime.MessageSender;
type Tab = chrome.tabs.Tab;

type HasTabId = MessageSender | Tab | number;

const OBSERVE_TARGETS: {
    [KEY: string]: {
        lastModified: string | null,
        abortController: AbortController,
        count: number,
        timer: any
        waiters: {
            [KEY: number]: (response: any) => void
        }
    }
} = {};

const FETCH_DELAY = 2500;

function error(message: string) {
    return {
        error: message
    };
}

function contentRequest(tab: HasTabId, type: string, dataset?: any) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
            getTabId(tab),
            {
                type,
                dataset
            },
            response => {
                resolve(response)
            }
        )
    });
}

function setPageActionIcon(tab: Tab | number, path: string) {
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    chrome.pageAction.setIcon({
        tabId: getTabId(tab),
        path: 'assets' + path
    });
}


function getTabId(tab: any): number {
    switch (typeof tab) {
        case 'number':
            return tab;
        case 'object':
            if (typeof tab['tab'] === 'object') {
                return tab.tab.id;
            }
            return tab.id;
    }
    return -1;
}

function getTabHost(tab: any): string {
    return tab['url']
        .split('/')
        .slice(0, 3)
        .join('/');
}


function removeTarget(tabId: number, file: string) {
    const target = OBSERVE_TARGETS[file];
    delete target.waiters[tabId];
    if (!--target.count) {
        target.abortController.abort();
        delete OBSERVE_TARGETS[file];
    }
}

function observe(tabId: number, url: string, send: (response: any) => void) {
    const target = OBSERVE_TARGETS[url];
    if (target) {
        const {waiters} = target;
        if (!waiters[tabId]) {
            waiters[tabId] = send;
            target.count++;
        }

        if (target.count === 1) {
            request(url);
        }

        return;
    }

    const abortController = new AbortController();

    OBSERVE_TARGETS[url] = {
        lastModified: null,
        abortController,
        timer: null,
        count: 1,
        waiters: {
            [tabId]: send
        }
    };

    request(url);
}

function unobserve(tabId: number, file: string) {
    const fetchUrl = OBSERVE_TARGETS[file];
    if (fetchUrl) {
        if (fetchUrl.waiters[tabId]) {
            removeTarget(tabId, file);
        }
    }
}

function unobserveAll(tab: HasTabId) {
    const tabId = getTabId(tab);

    Object.keys(OBSERVE_TARGETS).forEach(file => {
        const fetchUrl = OBSERVE_TARGETS[file];
        const {waiters} = fetchUrl;
        if (waiters[tabId]) {
            removeTarget(tabId, file);
        }
    });
}

function request(url: string) {
    const target = OBSERVE_TARGETS[url];

    if (!target) {
        return;
    }

    if (target.timer) {
        clearTimeout(target.timer)
    }

    fetch(url, {
        method: 'HEAD',
        signal: target.abortController.signal
    })
        .then(response => {
            const {headers} = response;

            const cacheControl = headers.get('Cache-Control');
            const lastModified = headers.get('Last-Modified');

            const {waiters} = target;
            const tabIds = Object.keys(waiters);

            if (!lastModified || (cacheControl && cacheControl.indexOf('no-') > -1)) {
                tabIds.forEach(tabId => {
                    waiters[Number(tabId)](null);
                });
            }

            if (target.lastModified === null) {
                target.lastModified = lastModified;
                return next(url);
            }

            if (lastModified !== target.lastModified) {
                delete OBSERVE_TARGETS[url];
                tabIds.forEach(tabId => {
                    waiters[Number(tabId)](lastModified);
                });

                return;
            }

            if (tabIds.length) {
                return next(url);
            }
        })
        .catch(reason => {

        });
}

function next(url: string) {
    const target = OBSERVE_TARGETS[url];

    target.timer = setTimeout(() => {
        target.timer = null;
        request(url);
    }, FETCH_DELAY);
}

function pageActionEnable(tab: HasTabId) {
    const tabId = getTabId(tab);

    unobserveAll(tabId);

    contentRequest(tabId, 'enabled')
        .then(response => {
            if (!response) {
                return;
            }

            localStorage.setItem(getTabHost(tab), String(Date.now()));
            setPageActionIcon(tabId, 'hot-dog-128.png');
        });
}

function pageActionDisable(tab: Tab) {
    const tabId = getTabId(tab);

    unobserveAll(tabId);

    contentRequest(tabId, 'disabled')
        .then(response => {
            if (!response) {
                return;
            }

            localStorage.removeItem(getTabHost(tab));
            setPageActionIcon(tabId, 'gray-dog-128.png');

        });
}

function pageActionToggle(tab: Tab) {
    if (localStorage.getItem(getTabHost(tab))) {
        pageActionDisable(tab);
    } else {
        pageActionEnable(tab);
    }
}

chrome.pageAction.onClicked.addListener(tab => {
    pageActionToggle(tab);
});

chrome.tabs.onUpdated.addListener(tabId => {
    unobserveAll(tabId);
});

chrome.tabs.onRemoved.addListener(tabId => {
    unobserveAll(tabId);
});

chrome.runtime.onMessage.addListener(({type, dataset}: { type: string, dataset: any }, sender, send) => {
    const tabId = getTabId(sender);
    const tabHost = getTabHost(sender);

    switch (type) {
        case 'connect':

            chrome.pageAction.show(tabId, () => {
            });

            if (localStorage.getItem(tabHost)) {
                pageActionEnable(sender);
                send(true);
            } else {
                send(false);
            }

            break;

        case 'observe':
            // console.log('observe', dataset.file);
            observe(tabId, dataset.file, send);

            break;

        case 'unobserve':
            // console.log('unobserve', dataset.file);
            unobserve(tabId, dataset.file);

            send(true);

            break;

        default:
            send(error('Unknown Type'));
    }
    return true;
});