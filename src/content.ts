(() => {
    function getUrl(url: string) {
        const a = document.createElement('a');
        a.href = url;
        return a.protocol + '//'
            + a.host
            + a.pathname
            + a.search
            + a.hash
    }

    function toBackground(type: string, dataset?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type, dataset
            }, (response: any) => {
                if (!response && response !== false && response !== 0) {
                    return reject({
                        message: 'Empty Response'
                    });
                }

                if (response['error']) {
                    console.warn(response['error']);
                    reject(response);
                } else {
                    resolve(response);
                }
            });
        })
    }

    function log(message: string) {
        return '[HotDog] ' + message;
    }

    class Target<T extends HTMLElement = HTMLElement, V extends HTMLElement = T> {
        protected selfObserve = this.observe.bind(this);
        protected selfReduce = this.reduce.bind(this);

        protected reloaded = 1;

        public file: string;

        constructor(public element: T | V, url: string) {
            element.dataset.hot = 'dog';

            if (url.startsWith('/') && url.startsWith('./')) {
                url = './' + url;
            }

            this.file = getUrl(url);
            this.observe();
        }

        observe() {
            toBackground('observe', {
                file: this.file
            })
                .then(lastModified => {
                    if (!lastModified) {
                        return;
                    }

                    (new Promise(this.selfReduce))
                        .then(this.selfObserve)
                        .catch(reason => {
                            console.warn(reason.message || reason);
                        })
                })
                .catch(reason => console.warn(reason.message || reason));
            return this;
        }

        unobserve() {
            toBackground('unobserve', {
                file: this.file
            }).then(() => {

            });
        }

        reload() {
            location.reload();
        }

        replace(newElement: V) {
            const {element} = this;
            const {parentNode} = element;
            if (!parentNode) {
                return;
            }
            newElement.dataset.hot = String(this.reloaded);
            parentNode.replaceChild(newElement, element);
            this.element = newElement;
        }

        reduce(resolve: (...args: any) => void, reject: (reason: any) => void): void {
            this.reload();
            resolve();
        }
    }

    class Stylesheet extends Target<HTMLLinkElement, HTMLStyleElement> {
        reduce(resolve: (...args: any) => void, reject: (reason: any) => void): void {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = this.file + '?' + (+new Date());
            this.replace(link);
            resolve();
        }
    }

    class Img extends Target<HTMLImageElement> {
        reduce(resolve: (...args: any) => void, reject: (reason: any) => void): void {
            this.element.src = this.file;
            resolve();
        }
    }

    const query = <T extends HTMLElement>(selector: string): T[] => Array.from(document.querySelectorAll(selector));
    const TARGETS: Target[] = [];

    function register() {
        TARGETS.forEach(unobserveMapFunction);
        TARGETS.splice(0, TARGETS.length);

        TARGETS.push(
            new Target<HTMLElement>(
                document.documentElement,
                location.href
            )
        );

        const labels: string[] = ['1 Document'];
        [
            {
                label: 'Script',
                selector: 'script[src]',
                attribute: 'src',
                target: Target,
                ignore: (url: string, element: HTMLScriptElement) => {
                    return element === document.currentScript;
                }
            },
            {
                label: 'Stylesheet',
                selector: 'link[href]',
                attribute: 'href',
                target: Stylesheet,
                ignore: (url: string) => false
            },
            {
                label: 'Image',
                selector: 'img[src]',
                attribute: 'src',
                target: Img,
                ignore: (url: string) => false
            }
        ].forEach(collections => {
            const elements = query(collections.selector);
            let end = elements.length;
            let element: any;
            let {label, attribute, target, ignore} = collections;
            let value;
            let count = 0;
            while (end-- > 0) {
                element = elements[end];
                value = element.getAttribute(attribute);
                if (!isObservable(value, element, ignore)) {
                    continue;
                }
                count++;
                TARGETS.push(new target(element, value));
            }
            if (count) {
                labels.push(`${count} ${label}${count > 1 ? 's' : ''}`);
            }
        })

        if (labels.length) {
            console.log(log(`${labels.join(', ')} are in Observing`));
        }

        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function ({addedNodes}) {
                let end = addedNodes.length;
                let element: HTMLElement;
                let value: string;
                while (end-- > 0) {
                    element = addedNodes[end] as HTMLElement;
                    if (element.nodeType !== 1) {
                        continue;
                    }
                    switch ((<HTMLElement>element).tagName) {
                        case 'SCRIPT':
                            value = (<HTMLScriptElement>element).src;
                            if (isObservable(
                                value,
                                element,
                                () => false
                            ) && !element.dataset.hot) {
                                TARGETS.push(
                                    new Target(
                                        element,
                                        value
                                    )
                                );
                            }
                    }
                }
            });
        });

        observer.observe(document.body, {
            childList: true
        });
    }

    function isObservable(value: string, element: HTMLElement, ignore: (...args: any[]) => boolean) {
        return !(
            !value
            || value.startsWith('data:')
            || (
                value.indexOf('://') > -1
                && !value.match(/https?:\/\/localhost|(127|192)(\.\d){3}/)
            )
            || ignore(value, element)
        );
    }

    function observeMapFunction(target: Target) {
        target.observe();
    }

    function unobserveMapFunction(target: Target) {
        target.unobserve();
    }

    function onVisibilityChange() {
        TARGETS.forEach(
            document.visibilityState === 'visible' ?
                observeMapFunction :
                unobserveMapFunction
        );
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    chrome.runtime.onMessage.addListener(({type, dataset}: any, sender, send) => {
        switch (type) {
            case 'enabled':
                send(true);
                document.addEventListener('visibilitychange', onVisibilityChange);
                register();
                break;

            case 'disabled':
                document.removeEventListener('visibilitychange', onVisibilityChange);
                send(true);
        }
        return true;
    });

    console.log(log('Hello?'));
    toBackground('connect').then();
})();
