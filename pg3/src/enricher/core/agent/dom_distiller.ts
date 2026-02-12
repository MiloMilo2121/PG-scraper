
import { Page } from 'puppeteer';
import { Logger } from '../../utils/logger';

/**
 * 👁️ DOM DISTILLER (The Sensor)
 * Reduces HTML noise by 95% to save tokens and improve LLM reasoning.
 * Only keeps interactive elements and meaningful text.
 */

export interface InteractiveElement {
    id: string;
    tagName: string;
    text: string;
    attributes: Record<string, string>;
    xpath: string;
}

export interface DOMSnapshot {
    title: string;
    url: string;
    summary: string; // Simplified HTML-like structure
    interactive: InteractiveElement[];
}

export class DOMDistiller {
    /**
     * Captures a simplified snapshot of the current page state.
     */
    public static async capture(page: Page): Promise<DOMSnapshot> {
        try {
            const snapshot = await page.evaluate(() => {
                let idCounter = 0;
                const interactive: any[] = [];

                function isVisible(elem: Element): boolean {
                    const style = window.getComputedStyle(elem);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                }

                function getXPath(element: Element): string {
                    if (element.id !== '') return `//*[@id="${element.id}"]`;
                    if (element === document.body) return element.tagName;
                    let ix = 0;
                    const siblings = element.parentNode?.childNodes;
                    if (!siblings) return element.tagName;
                    for (let i = 0; i < siblings.length; i++) {
                        const sibling = siblings[i];
                        if (sibling === element) return `${getXPath(element.parentNode as Element)}/${element.tagName}[${ix + 1}]`;
                        if (sibling.nodeType === 1 && (sibling as Element).tagName === element.tagName) ix++;
                    }
                    return element.tagName;
                }

                function traverse(node: Node, depth: number = 0): string {
                    if (depth > 20) return ''; // Prevent deep recursion
                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = (node.textContent || '').trim();
                        return text.length > 3 ? text : '';
                    }

                    if (node.nodeType !== Node.ELEMENT_NODE) return '';
                    const elem = node as HTMLElement;
                    if (!isVisible(elem)) return '';

                    const tagName = elem.tagName.toLowerCase();
                    // Skip noise
                    if (['script', 'style', 'noscript', 'svg', 'path', 'meta', 'link'].includes(tagName)) return '';

                    // Check interactivity
                    const isInteractive =
                        tagName === 'a' ||
                        tagName === 'button' ||
                        tagName === 'input' ||
                        tagName === 'select' ||
                        tagName === 'textarea' ||
                        elem.onclick != null ||
                        (elem.getAttribute('role') === 'button');

                    let output = '';
                    let inner = '';

                    // Recurse
                    const children = Array.from(node.childNodes);
                    for (const child of children) {
                        inner += traverse(child, depth + 1) + ' ';
                    }
                    inner = inner.replace(/\s+/g, ' ').trim();

                    if (isInteractive) {
                        idCounter++;
                        const id = idCounter.toString();
                        const attributes: Record<string, string> = {};
                        if (elem.getAttribute('href')) attributes.href = elem.getAttribute('href')!;
                        if (elem.getAttribute('placeholder')) attributes.placeholder = elem.getAttribute('placeholder')!;
                        if (elem.getAttribute('aria-label')) attributes.ariaLabel = elem.getAttribute('aria-label')!;
                        if (elem.getAttribute('name')) attributes.name = elem.getAttribute('name')!;
                        if (elem.getAttribute('type')) attributes.type = elem.getAttribute('type')!;

                        // Store for side-channel access (not in the prompt to save tokens)
                        interactive.push({
                            id,
                            tagName,
                            text: inner.slice(0, 50),
                            attributes,
                            xpath: getXPath(elem)
                        });

                        // Inject ID into prompt representation
                        if (tagName === 'a') return `[LINK id=${id} ctx="${inner.slice(0, 30)}"]`;
                        if (tagName === 'button') return `[BTN id=${id} ctx="${inner.slice(0, 30)}"]`;
                        if (tagName === 'input') return `[INPUT id=${id} name="${attributes.name || ''}"]`;
                        return `[ACT id=${id} ctx="${inner.slice(0, 30)}"]`;
                    }

                    // Structural elements: keep simplified layout
                    if (['div', 'section', 'main', 'header', 'footer', 'nav', 'ul', 'li', 'h1', 'h2', 'h3', 'p', 'span'].includes(tagName)) {
                        if (inner.length > 0) {
                            if (['h1', 'h2', 'h3'].includes(tagName)) return `\n# ${inner}\n`;
                            if (tagName === 'li') return `\n- ${inner}`;
                            if (tagName === 'p') return `\n${inner}\n`;
                            return `${inner} `;
                        }
                    }

                    return inner;
                }

                const summary = traverse(document.body);
                return {
                    title: document.title,
                    url: window.location.href,
                    summary: summary.replace(/\n\s*\n/g, '\n').slice(0, 15000), // Hard cap 15k chars
                    interactive
                };
            });

            return snapshot;
        } catch (error) {
            Logger.error('[DOMDistiller] Failed to capture snapshot', { error: error as Error });
            return { title: 'Error', url: 'error', summary: '', interactive: [] };
        }
    }
}
