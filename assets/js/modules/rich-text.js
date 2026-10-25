// Light formatting for long text that administrators write in plain
// textareas: event descriptions, volunteer instructions, and blog sections.
// The database keeps the plain text. This module turns it into DOM nodes with
// createElement/textContent, so saved text is never parsed as HTML.
//
//   Blank line           new paragraph
//   Line break           kept as a line break
//   **bold**  *italic*   inline emphasis
//   - item  * item       bulleted list
//   1. item              numbered list
//   [label](https://…)   link; bare https:// URLs and email addresses link too

const bulletPattern = /^\s*[-*•]\s+(.*)$/;
const numberPattern = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const markerPattern = /^\s*(?:[-*•]|\d{1,3}[.)])\s+/;
// No lookbehind: Safari before 16.4 rejects it, and a syntax error here would
// stop every page that imports this module.
const inlineSource = [
	/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/.source,
	/\*\*(\S(?:.*?\S)?)\*\*(?!\*)/.source,
	/\*([^\s*](?:[^*\n]*?[^\s*])?)\*/.source,
	/(https?:\/\/[^\s<>]+)/.source,
	/([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/.source,
].join("|");

const safeHref = (value) => {
	try {
		const url = new URL(value);
		return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
};

const count = (text, character) => text.split(character).length - 1;

// Sentence punctuation after a bare URL belongs to the sentence, and a closing
// parenthesis only belongs to the URL when the URL opened one.
const trimBareUrl = (url) => {
	let end = url.length;
	while (end > 0) {
		const kept = url.slice(0, end);
		const last = kept[end - 1];
		if (/[.,;:!?'"*]/.test(last)) end -= 1;
		else if (last === ")" && count(kept, "(") < count(kept, ")")) end -= 1;
		else break;
	}
	return url.slice(0, end);
};

export const parseInline = (text) => {
	const nodes = [];
	const pushText = (value) => {
		if (!value) return;
		const previous = nodes[nodes.length - 1];
		if (previous?.type === "text") previous.text += value;
		else nodes.push({ type: "text", text: value });
	};
	const source = String(text || "");
	const pattern = new RegExp(inlineSource, "g");
	let cursor = 0;
	for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
		const [whole, label, labelledHref, bold, italic, bareUrl, email] = match;
		let consumed = whole;
		let node = null;
		if (label) {
			const href = safeHref(labelledHref);
			if (href) node = { type: "link", href, text: label };
		} else if (bold) {
			node = { type: "strong", children: parseInline(bold) };
		} else if (italic) {
			node = { type: "em", children: parseInline(italic) };
		} else if (bareUrl) {
			consumed = trimBareUrl(bareUrl);
			const href = safeHref(consumed);
			if (href) node = { type: "link", href, text: consumed };
		} else if (email) {
			node = { type: "link", href: `mailto:${email}`, text: email };
		}
		pushText(source.slice(cursor, match.index));
		if (node) nodes.push(node);
		else pushText(consumed);
		cursor = match.index + consumed.length;
		pattern.lastIndex = cursor;
	}
	pushText(source.slice(cursor));
	return nodes;
};

const listMarker = (line) => {
	const bullet = bulletPattern.exec(line);
	if (bullet) return { ordered: false, bullet: line.trim()[0], text: bullet[1] };
	const number = numberPattern.exec(line);
	if (number) return { ordered: true, start: Number(number[1]), text: number[2] };
	return null;
};

export const parseRichText = (text) => {
	const blocks = [];
	let paragraph = null;
	let list = null;
	// A blank line ends a paragraph. A list survives one so that items written
	// with space between them still read as one list.
	let blankSinceItem = false;

	const closeParagraph = () => {
		if (paragraph) blocks.push({ type: "paragraph", lines: paragraph });
		paragraph = null;
	};
	const closeList = () => {
		if (list) blocks.push(list);
		list = null;
	};

	String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((rawLine) => {
		const line = rawLine.trim();
		if (!line) {
			closeParagraph();
			blankSinceItem = Boolean(list);
			return;
		}
		const marker = listMarker(line);
		if (marker) {
			closeParagraph();
			if (!list || list.ordered !== marker.ordered) {
				closeList();
				list = { type: "list", ordered: marker.ordered, start: marker.start || 1, bullet: marker.bullet, items: [] };
			}
			list.items.push([marker.text]);
			blankSinceItem = false;
			return;
		}
		if (list && !blankSinceItem) {
			list.items[list.items.length - 1].push(line);
			return;
		}
		closeList();
		paragraph ||= [];
		paragraph.push(line);
	});
	closeParagraph();
	closeList();

	return blocks.map((block) => {
		if (block.type === "paragraph") return { type: "paragraph", lines: block.lines.map(parseInline) };
		// "- PCA Student Council" on its own is a sign-off, not a one-item list.
		if (!block.ordered && block.bullet === "-" && block.items.length === 1 && block.items[0].length === 1) {
			return { type: "paragraph", lines: [parseInline(`- ${block.items[0][0]}`)] };
		}
		return {
			type: "list",
			ordered: block.ordered,
			start: block.start,
			items: block.items.map((lines) => lines.map(parseInline)),
		};
	});
};

const appendInline = (parent, nodes) => {
	nodes.forEach((node) => {
		if (node.type === "text") {
			parent.appendChild(document.createTextNode(node.text));
			return;
		}
		if (node.type === "link") {
			const link = document.createElement("a");
			link.href = node.href;
			link.textContent = node.text;
			if (!node.href.startsWith("mailto:")) {
				link.target = "_blank";
				link.rel = "noopener noreferrer";
			}
			parent.appendChild(link);
			return;
		}
		const element = document.createElement(node.type);
		appendInline(element, node.children);
		parent.appendChild(element);
	});
};

const appendLines = (parent, lines) => {
	lines.forEach((nodes, index) => {
		if (index) parent.appendChild(document.createElement("br"));
		appendInline(parent, nodes);
	});
};

// Appends the formatted paragraphs and lists to container and returns it.
export const renderRichText = (container, text) => {
	parseRichText(text).forEach((block) => {
		if (block.type === "paragraph") {
			const paragraph = document.createElement("p");
			appendLines(paragraph, block.lines);
			container.appendChild(paragraph);
			return;
		}
		const list = document.createElement(block.ordered ? "ol" : "ul");
		if (block.ordered && block.start !== 1) list.start = block.start;
		block.items.forEach((lines) => {
			const item = document.createElement("li");
			appendLines(item, lines);
			list.appendChild(item);
		});
		container.appendChild(list);
	});
	return container;
};

// A standalone formatted block. The pca-rich-text class gives every surface
// the same paragraph and list spacing.
export const createRichText = (text, tagName = "div", className = "") => {
	const container = document.createElement(tagName);
	container.className = `pca-rich-text${className ? ` ${className}` : ""}`;
	return renderRichText(container, text);
};

// Toolbar edits take the textarea value and selection and return the new
// value and selection, so they are testable without a browser.

const leadingStars = (text) => text.match(/^\**/)[0].length;
const trailingStars = (text) => text.match(/\**$/)[0].length;
// Bold owns stars in pairs and italic owns the odd one, so "***both***" can
// lose either style without disturbing the other.
const ownsStars = (stars, marker) => (marker === "**" ? stars >= 2 : stars % 2 === 1);

const wrapSelection = (value, start, end, marker, placeholder) => {
	const selected = value.slice(start, end);
	const leading = selected.match(/^\s*/)[0];
	const trailing = selected.slice(leading.length).match(/\s*$/)[0];
	let inner = selected.slice(leading.length, selected.length - trailing.length);
	let before = value.slice(0, start + leading.length);
	let after = value.slice(end - trailing.length);
	const size = marker.length;

	const insideStars = Math.min(leadingStars(inner), trailingStars(inner));
	if (inner.length > size * 2 && ownsStars(insideStars, marker)) {
		before += inner.slice(0, size);
		after = inner.slice(-size) + after;
		inner = inner.slice(size, -size);
	}
	const outsideStars = Math.min(trailingStars(before), leadingStars(after));
	if (inner && ownsStars(outsideStars, marker)) {
		const selectionStart = before.length - size;
		return {
			value: before.slice(0, -size) + inner + after.slice(size),
			selectionStart,
			selectionEnd: selectionStart + inner.length,
		};
	}
	const text = inner || placeholder;
	const selectionStart = before.length + size;
	return {
		value: `${before}${marker}${text}${marker}${after}`,
		selectionStart,
		selectionEnd: selectionStart + text.length,
	};
};

const toggleList = (value, start, end, ordered) => {
	const lineStart = value.lastIndexOf("\n", start - 1) + 1;
	const searchFrom = end > start && value[end - 1] === "\n" ? end - 1 : end;
	const lineBreak = value.indexOf("\n", searchFrom);
	const lineEnd = lineBreak === -1 ? value.length : lineBreak;
	const lines = value.slice(lineStart, lineEnd).split("\n");
	const pattern = ordered ? numberPattern : bulletPattern;
	const filled = lines.filter((line) => line.trim());
	const removing = filled.length > 0 && filled.every((line) => pattern.test(line));
	let number = 0;
	const updated = filled.length
		? lines.map((line) => {
			if (!line.trim()) return line;
			const text = line.replace(markerPattern, "");
			if (removing) return text;
			number += 1;
			return ordered ? `${number}. ${text}` : `- ${text}`;
		}).join("\n")
		: ordered ? "1. " : "- ";
	const caret = lineStart + updated.length;
	return {
		value: value.slice(0, lineStart) + updated + value.slice(lineEnd),
		selectionStart: lines.length > 1 ? lineStart : caret,
		selectionEnd: caret,
	};
};

const insertLink = (value, start, end) => {
	const selected = value.slice(start, end).trim();
	const isUrl = /^(?:https?:\/\/|mailto:)\S+$/i.test(selected);
	const label = isUrl || !selected ? "link text" : selected;
	const href = isUrl ? selected : "https://";
	// Select what still needs typing: the words when there are none yet,
	// otherwise the web address.
	const selectLabel = !selected || isUrl;
	const selectionStart = selectLabel ? start + 1 : start + label.length + 3;
	return {
		value: `${value.slice(0, start)}[${label}](${href})${value.slice(end)}`,
		selectionStart,
		selectionEnd: selectionStart + (selectLabel ? label.length : href.length),
	};
};

export const applyRichTextCommand = (command, value, selectionStart, selectionEnd) => {
	const start = Math.min(selectionStart, selectionEnd);
	const end = Math.max(selectionStart, selectionEnd);
	if (command === "bold") return wrapSelection(value, start, end, "**", "bold text");
	if (command === "italic") return wrapSelection(value, start, end, "*", "italic text");
	if (command === "bullets") return toggleList(value, start, end, false);
	if (command === "numbers") return toggleList(value, start, end, true);
	if (command === "link") return insertLink(value, start, end);
	return { value, selectionStart, selectionEnd };
};

const toolbarCommands = [
	{ command: "bold", label: "B", title: "Bold", shortcut: "b", className: "is-bold" },
	{ command: "italic", label: "I", title: "Italic", shortcut: "i", className: "is-italic" },
	{ command: "bullets", label: "• List", title: "Bulleted list" },
	{ command: "numbers", label: "1. List", title: "Numbered list" },
	{ command: "link", label: "Link", title: "Link", shortcut: "k" },
];

let editorSequence = 0;

// Wraps a textarea with a formatting toolbar, a preview, and a syntax hint.
// Calling it again on the same textarea returns the existing editor.
export const installRichTextEditor = (textarea) => {
	if (!textarea) return null;
	if (textarea.richTextEditor) return textarea.richTextEditor;
	editorSequence += 1;
	const idBase = textarea.id || `pca-rich-text-${editorSequence}`;
	const shortcutPrefix = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl+";

	const shell = document.createElement("div");
	shell.className = "pca-rich-editor";
	textarea.before(shell);

	const toolbar = document.createElement("div");
	toolbar.className = "pca-rich-editor__toolbar";
	toolbar.setAttribute("role", "toolbar");
	toolbar.setAttribute("aria-label", "Text formatting");
	if (textarea.id) toolbar.setAttribute("aria-controls", textarea.id);

	const preview = document.createElement("div");
	preview.className = "pca-rich-editor__preview pca-rich-text";
	preview.id = `${idBase}-preview`;
	preview.hidden = true;
	preview.setAttribute("role", "region");
	preview.setAttribute("aria-label", "Formatted preview");

	const hint = document.createElement("p");
	hint.className = "pca-form-help pca-rich-editor__hint";
	hint.id = `${idBase}-format-help`;
	hint.textContent = "Leave a blank line between paragraphs. Wrap words in **two stars** for bold or *one star* for italic. Lines starting with - or 1. become lists, and web addresses become links.";
	const describedBy = new Set((textarea.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
	describedBy.add(hint.id);
	textarea.setAttribute("aria-describedby", [...describedBy].join(" "));

	const renderPreview = () => {
		preview.replaceChildren();
		if (textarea.value.trim()) {
			renderRichText(preview, textarea.value);
		} else {
			const empty = document.createElement("p");
			empty.className = "pca-rich-editor__empty";
			empty.textContent = "Nothing to preview yet.";
			preview.appendChild(empty);
		}
	};

	const run = (command) => {
		const result = applyRichTextCommand(command, textarea.value, textarea.selectionStart, textarea.selectionEnd);
		if (textarea.maxLength > 0 && result.value.length > textarea.maxLength) return;
		textarea.focus();
		textarea.value = result.value;
		textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	};

	const buttons = toolbarCommands.map(({ command, label, title, shortcut, className }) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `pca-rich-editor__button${className ? ` ${className}` : ""}`;
		button.textContent = label;
		button.title = shortcut ? `${title} (${shortcutPrefix}${shortcut.toUpperCase()})` : title;
		button.setAttribute("aria-label", title);
		if (shortcut) button.setAttribute("aria-keyshortcuts", `Control+${shortcut.toUpperCase()} Meta+${shortcut.toUpperCase()}`);
		// Keep the textarea selection when the button is pressed with a mouse.
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () => run(command));
		return button;
	});

	const previewToggle = document.createElement("button");
	previewToggle.type = "button";
	previewToggle.className = "pca-rich-editor__button pca-rich-editor__preview-toggle";
	previewToggle.textContent = "Preview";
	previewToggle.setAttribute("aria-pressed", "false");
	previewToggle.setAttribute("aria-controls", preview.id);
	const setPreviewOpen = (open) => {
		preview.hidden = !open;
		previewToggle.setAttribute("aria-pressed", String(open));
		if (open) renderPreview();
	};
	previewToggle.addEventListener("click", () => setPreviewOpen(preview.hidden));

	// One Tab stop for the toolbar; arrow keys move between its buttons.
	const toolbarButtons = [...buttons, previewToggle];
	toolbarButtons.forEach((button, index) => { button.tabIndex = index ? -1 : 0; });
	toolbar.addEventListener("keydown", (event) => {
		const current = toolbarButtons.indexOf(document.activeElement);
		const last = toolbarButtons.length - 1;
		const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: last }[event.key];
		if (current === -1 || next === undefined) return;
		event.preventDefault();
		const target = toolbarButtons[(next + toolbarButtons.length) % toolbarButtons.length];
		toolbarButtons.forEach((button) => { button.tabIndex = button === target ? 0 : -1; });
		target.focus();
	});
	toolbar.append(...toolbarButtons);

	textarea.addEventListener("keydown", (event) => {
		if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
		const match = toolbarCommands.find(({ shortcut }) => shortcut === event.key.toLowerCase());
		if (!match) return;
		event.preventDefault();
		run(match.command);
	});
	textarea.addEventListener("input", () => {
		if (!preview.hidden) renderPreview();
	});
	// form.reset() and programmatic loads do not fire input events.
	textarea.form?.addEventListener("reset", () => window.setTimeout(() => setPreviewOpen(false)));

	shell.append(toolbar, textarea, preview, hint);
	const editor = {
		refresh: () => { if (!preview.hidden) renderPreview(); },
		// Blog headings stay plain text, so their sections hide the tools.
		setEnabled: (enabled) => {
			toolbar.hidden = !enabled;
			hint.hidden = !enabled;
			if (!enabled) setPreviewOpen(false);
		},
	};
	textarea.richTextEditor = editor;
	return editor;
};
