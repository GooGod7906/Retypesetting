(function () {
  const sample = {
    number: 1,
    size: [210, 297],
    items: [
      ['header', '物理练习卷', [17, 9, 125, 15]],
      ['heading1', '第一章　运动与力', [17, 22, 193, 32]],
      ['instructions', '注意事项：请在答题区域写出解题过程。', [17, 40, 193, 47]],
      ['heading2', '一、单项选择题', [17, 56, 193, 64]],
      ['stem', '1. 物体由静止开始做匀加速直线运动。已知加速度为 a，请根据速度与时间的关系作答。', [17, 72, 193, 85]],
      ['formula', String.raw`v=v_0+at`, [19, 93, 85, 103]],
      ['option', 'A. 速度保持不变', [17, 112, 91, 119]],
      ['option', 'B. 速度随时间增大', [107, 112, 193, 119]],
      ['table', '时间（s）　0　1　2', [17, 129, 193, 144]],
      ['caption', '表 1　各时刻的速度', [17, 148, 193, 155]],
      ['footer', '物理练习卷　第 1 页', [17, 275, 193, 282]],
    ].map(([role, text, box], index) => ({ role, text, box, group: index, line: index,
      kind: role === 'formula' || role === 'table' ? role : 'text', level: role.startsWith('heading') ? Number(role.slice(7)) : undefined })),
  };

  function styleKind(item, flow = false) {
    if (['formula', 'table'].includes(item.kind)) return item.kind;
    if (item.roleOverride) return item.roleOverride;
    if (flow && item.flowRole) return item.flowRole;
    if (['instructions', 'option', 'stem', 'header'].includes(item.role)) return item.role;
    if (['footer', 'page_number'].includes(item.role)) return 'footer';
    if (item.role.includes('caption')) return 'caption';
    return item.level ? `heading${Math.max(1, Math.min(9, item.level))}` : 'body';
  }

  function renderContent(element, item, template, assetPath) {
    if (item.kind === 'formula' && template.formulaMode === 'latex' && item.text) {
      element.textContent = `$${item.text}$`;
    } else if (item.crop) {
      const image = document.createElement('img');
      image.src = `data:image/png;base64,${item.crop}`;
      image.alt = '原卷局部';
      image.className = 'inline-crop';
      element.append(image);
    } else if (item.asset && assetPath && (item.kind !== 'formula' || !item.text)) {
      const image = document.createElement('img');
      image.src = assetPath(item.asset);
      image.alt = item.kind === 'table' ? '表格' : item.kind === 'formula' ? '公式' : '配图';
      element.append(image);
    } else if (item.kind === 'formula' && item.text && window.katex) {
      const style = { ...template.styles.body, ...template.styles.formula };
      const weight = style.bold === true ? `\\boldsymbol{${item.text}}` : item.text;
      window.katex.render(style.underline ? `\\underline{${weight}}` : weight, element, { throwOnError: false, trust: false });
    } else {
      const text = item.text ?? (item.kind === 'table' ? '表格' : '配图');
      const appendText = part => appendStyledText(element, part, template, styleKind(item, template.mode === 'flow'));
      if (template.mode === 'flow' && item.kind === 'text') {
        for (const part of text.split(/([_＿]{2,})/u)) {
          if (/^[_＿]{2,}$/u.test(part)) element.append(inlineRule([...part].reduce((width, character) => width + (character === '＿' ? 1 : 0.5), 0) + 'em'));
          else appendText(part);
        }
      } else appendText(text);
    }
  }

  const sameRow = (a, b) => Math.min(a[3], b[3]) - Math.max(a[1], b[1]) >= Math.min(a[3] - a[1], b[3] - b[1]) * .6;
  const optionStart = /^[A-GＡ-Ｇ]\s*[.．、)）]/u;
  const sectionHeading = /^(?:第[一二三四ⅠⅡIV\d]+[卷部分]|[一二三四五六七八九十]+[、.．])/u;
  window.previewTitleGroups = function (page) {
    if (page.number !== 1) return new Set();
    if (page.items.some(item => item.flowRole)) return new Set(page.items.filter(item => item.mainTitle).map(item => item.group));
    const titles = page.items.filter(item => item.kind === 'text' && item.level === 1 && item.role !== 'instructions' && !sectionHeading.test(item.text ?? ''));
    const main = titles[0];
    if (!main) return new Set();
    const [left, top, right, bottom] = main.box;
    return new Set(titles.filter(item => item.group === main.group || (item.box[1] >= bottom
      && item.box[1] - bottom <= (bottom - top) * 1.5
      && Math.abs(item.box[0] + item.box[2] - left - right) <= page.size[0] * .12)).map(item => item.group));
  };
  function formatMarker(text, role, width) {
    if (!width || width === 'preserve') return text;
    const dot = width === 'full' ? '．' : '.';
    if (role === 'option') return text.replace(/^([A-GＡ-Ｇ])\s*([.．、)）])\s*/u, (_, letter, marker) =>
      letter + (/[)）]/.test(marker) ? (width === 'full' ? '）' : ')') : dot));
    if (role === 'stem' || role === 'body') return text.replace(/^([0-9０-９]{1,3})[.．、](?=\s|[\p{Script=Han}A-Za-z（(]|$)\s*/u, (_, number) => number + dot);
    return text;
  }

  function resolveStyle(template, role) {
    const own = template.styles?.[role];
    const body = own?.inheritBody === false ? undefined : template.styles?.body;
    const style = { font: template.font, ...body, ...own };
    if (own?.font) for (const field of ['fontChinese', 'fontEnglish', 'fontPunctuation']) style[field] = own[field];
    return style;
  }

  function appendStyledText(element, text, template, role) {
    const style = resolveStyle(template, role);
    if (!style.fontPunctuation && !style.fontChinese && !style.fontEnglish) { element.append(text); return; }
    let segment;
    let previous;
    const characters = [...text];
    const latin = /[\p{Script=Latin}\p{Nd}]/u;
    for (const [index, char] of characters.entries()) {
      const englishSpace = char === ' ' && latin.test(characters[index - 1] ?? '') && latin.test(characters[index + 1] ?? '');
      const font = (/\p{P}/u.test(char) ? style.fontPunctuation : /\p{Script=Han}/u.test(char) ? style.fontChinese
        : latin.test(char) || englishSpace ? style.fontEnglish : undefined) ?? style.font;
      if (!segment || font !== previous) {
        segment = document.createElement('span');
        if (font) segment.style.fontFamily = `"${font.replace(/["\\]/g, '')}", serif`;
        element.append(segment);
        previous = font;
      }
      segment.textContent += char;
    }
  }

  window.renderStyledPreviewText = function (element, item, template, flow = false) {
    if (!template || item.kind !== 'text') return;
    const role = styleKind(item, flow);
    element.replaceChildren();
    appendStyledText(element, formatMarker(item.text ?? '', role, template.markerWidth), template, role);
  };

  function inlineRule(width) {
    const rule = document.createElement('span');
    rule.className = 'inline-answer-rule';
    rule.style.width = width;
    return rule;
  }

  window.placePreviewRule = function (paper, [x, y, right, bottom], width, height) {
    const rule = document.createElement('span');
    rule.className = 'preview-answer-rule';
    Object.assign(rule.style, { left: (x / width * 100) + '%', top: (y / height * 100) + '%',
      width: ((right - x) / width * 100) + '%', height: ((bottom - y) / height * 100) + '%' });
    paper.append(rule);
  };

  function applyStyle(element, template, role, width, size, defaults) {
    const style = resolveStyle(template, role);
    const toCqw = millimeters => `${100 * millimeters / width}cqw`;
    element.style.fontFamily = style.font ? `"${style.font.replace(/["\\]/g, '')}", serif` : 'serif';
    element.style.fontSize = toCqw((style.fontSizePt ?? size) * 25.4 / 72);
    const toPoints = points => toCqw(points * 25.4 / 72);
    element.style.lineHeight = style.lineSpacingPt === undefined ? style.lineSpacing ?? defaults.minLineHeightRatio
      : `max(${defaults.minLineHeightRatio}em, ${toPoints(style.lineSpacingPt)})`;
    element.style.color = style.color ?? '';
    element.style.fontWeight = (style.bold ?? role.startsWith('heading')) ? '700' : '400';
    if (role !== 'formula' || template.formulaMode === 'latex') element.style.textDecoration = style.underline ? 'underline' : 'none';
    if (style.letterSpacingPt !== undefined) element.style.letterSpacing = toCqw(style.letterSpacingPt * 25.4 / 72);
    if (style.firstLineIndentMm !== undefined) element.style.textIndent = toCqw(style.firstLineIndentMm);
    if (style.leftIndentMm !== undefined) element.style.paddingInlineStart = toCqw(style.leftIndentMm);
    if (style.rightIndentMm !== undefined) element.style.paddingInlineEnd = toCqw(style.rightIndentMm);
    if (style.spaceBeforePt !== undefined) element.style.paddingBlockStart = toPoints(style.spaceBeforePt);
    if (style.spaceAfterPt !== undefined) element.style.paddingBlockEnd = toPoints(style.spaceAfterPt);
    if (style.alignment) element.style.textAlign = style.alignment;
  }

  // Measure the content after the paper has a width, including after font loading or resizing.
  const fitObserver = new ResizeObserver(entries => {
    for (const { target } of entries) {
      if (target.clientWidth && target.clientHeight) fitPage(target);
    }
  });
  const watched = new WeakSet();

  function fitPage(paper) {
    const items = [...paper.querySelectorAll('.bounded-preview > .bounded-content')];
    for (const item of items) item.style.fontSize = '';
    const measurements = items.map(item => {
      const frame = item.parentElement;
      const size = parseFloat(getComputedStyle(item).fontSize);
      const factor = Math.min(1, frame.clientWidth / Math.max(1, item.scrollWidth), frame.clientHeight / Math.max(1, item.scrollHeight));
      return [item, size * factor];
    });
    for (const [item, size] of measurements) if (size > 0) item.style.fontSize = `${size}px`;
  }

  window.watchPreviewBounds = function (paper) {
    if (!watched.has(paper)) {
      fitObserver.observe(paper);
      watched.add(paper);
    }
    requestAnimationFrame(() => { if (paper.isConnected && paper.clientWidth) fitPage(paper); });
    document.fonts.ready.then(() => { if (paper.isConnected && paper.clientWidth) fitPage(paper); });
  };

  window.templateAutoHeight = function (template, page = sample) {
    const { top, right, bottom, left } = template.margins;
    return Math.min(558, (template.widthMm - left - right) * page.size[1] / page.size[0] + top + bottom);
  };

  window.renderTemplatePreview = function (target, { template, defaults, page = sample, assetPath, role, pageCount, filename, footerPattern }) {
    if (target.firstElementChild) fitObserver.unobserve(target.firstElementChild);
    const width = template.widthMm;
    const { top, right, bottom, left } = template.margins;
    const [sourceWidth, sourceHeight] = page.size;
    const contentWidth = width - left - right;
    const height = template.heightMm ?? window.templateAutoHeight(template, page);
    if (!(width >= 40 && width <= 558 && height >= 40 && height <= 558 && contentWidth > 0 && height > top + bottom)) {
      const error = document.createElement('p');
      error.className = 'muted';
      error.textContent = '请填写有效的纸张尺寸和页边距。';
      target.replaceChildren(error);
      return;
    }
    const scale = Math.min(contentWidth / sourceWidth, (height - top - bottom) / sourceHeight);
    const xOffset = left + (contentWidth - sourceWidth * scale) / 2;
    const yOffset = top + (height - top - bottom - sourceHeight * scale) / 2;
    const paper = document.createElement('div');
    paper.className = 'template-paper';
    paper.dataset.mode = template.mode;
    paper.style.aspectRatio = `${width} / ${height}`;
    const flow = template.mode === 'flow';
    const bodyItems = page.items.filter(item => item.kind === 'text' && !item.level && ['body', 'text', 'stem', 'option', 'list'].includes(item.role));
    const reference = bodyItems.length ? bodyItems : page.items.filter(item => !['header', 'footer', 'page_number'].includes(item.role));
    let sourceLeft = Math.max(0, Math.min(...reference.map(item => item.box[0])));
    let textWidth = Math.min(sourceWidth, Math.max(...reference.map(item => item.box[2]))) - sourceLeft;
    if (textWidth < sourceWidth * .4) { sourceLeft = 0; textWidth = sourceWidth; }
    const flowScale = contentWidth / textWidth;
    const titleGroups = flow ? window.previewTitleGroups(page) : new Set();
    const pct = (value, reference) => `${value / reference * 100}%`;
    const toCqw = value => `${value * 100 / width}cqw`;
    const styles = [top, right, bottom, left].map(value => pct(value, width));
    if (flow) paper.style.padding = styles.join(' ');
    const rules = new Map();
    for (const rule of page.rules ?? []) {
      const attached = rules.get(rule.after) ?? [];
      attached.push(rule.box);
      rules.set(rule.after, attached);
    }
    let previous = null;
    const placed = new Set();
    for (const [index, item] of page.items.entries()) {
      if (placed.has(item)) continue;
      const kind = styleKind(item, flow);
      if ((kind === 'footer' && template.footer) || (!template.showPageMarks && ['header', 'footer'].includes(kind))) continue;
      const [x, y, x1, y1] = item.box;
      const standalone = item.kind === 'image' || item.kind === 'table';
      const element = document.createElement(flow && !standalone ? 'span' : 'div');
      element.className = `template-block${standalone ? ' template-figure' : ''}`;
      if (kind === role) element.dataset.selected = '';
      const uniform = !flow && ['body', 'stem', 'option'].includes(kind);
      if (uniform) element.dataset.uniformText = '';
      const defaultSize = uniform ? defaults.fixedBodyFontSizePt ?? defaults.flowFontSizePt.body
        : flow ? defaults.flowFontSizePt[kind === 'heading1' ? 'heading1' : kind.startsWith('heading') ? 'heading' : 'body']
        : Math.min(26, Math.max(5, (y1 - y) * scale * 72 / 25.4 * 0.82));
      const content = flow || standalone ? element : document.createElement('span');
      applyStyle(element, template, kind, width, defaultSize, defaults);
      const blank = item.kind === 'text' && /^[_＿]+$/.test(item.text ?? '');
      if (!blank) renderContent(content, { ...item, text: item.kind === 'text' ? formatMarker(item.text ?? '', kind, template.markerWidth) : item.text }, template, assetPath);
      if (item.kind === 'formula' && item.crop && flow && template.formulaMode !== 'latex') content.firstElementChild.style.width = toCqw((x1 - x) * scale);
      if (!flow) {
        if (blank) {
          window.placePreviewRule(paper, [xOffset + x * scale, yOffset + (y + (y1 - y) * .82) * scale,
            xOffset + x1 * scale, yOffset + (y + (y1 - y) * .88) * scale], width, height);
          continue;
        }
        const nextLeft = Math.min(sourceWidth, ...page.items.filter(other => other !== item && other.box[0] >= x1 && sameRow(item.box, other.box)).map(other => other.box[0]));
        const end = standalone ? x1 : Math.min(nextLeft, x1 + (y1 - y) * .55);
        Object.assign(element.style, { position: 'absolute', left: pct(xOffset + x * scale, width), top: pct(yOffset + y * scale, height),
          width: pct((end - x) * scale, width), height: pct((y1 - y) * scale, height) });
        element.classList.add('bounded-preview');
        if (content !== element) {
          content.className = 'bounded-content';
          element.append(content);
        }
        paper.append(element);
      } else if (standalone) {
        const row = item.kind === 'image' ? [item, ...page.items.slice(index + 1).filter(other => other.kind === 'image'
          && !placed.has(other) && sameRow(item.box, other.box) && (other.box[0] >= x1 || other.box[2] <= x))] : [item];
        row.sort((a, b) => a.box[0] - b.box[0]);
        const start = row[0].box[0];
        const span = Math.max(...row.map(figure => figure.box[2])) - start;
        const ratio = Math.min(flowScale, contentWidth / span);
        const wrapper = document.createElement('div');
        wrapper.className = 'template-figure-row';
        wrapper.style.marginInlineStart = toCqw(Math.min(Math.max(0, (start - sourceLeft) * flowScale), Math.max(0, contentWidth - span * ratio)));
        let previousRight = start;
        for (const figure of row) {
          const block = figure === item ? element : document.createElement('div');
          if (figure !== item) {
            block.className = 'template-figure';
            renderContent(block, figure, template, assetPath);
          }
          block.style.width = toCqw((figure.box[2] - figure.box[0]) * ratio);
          block.style.marginInlineStart = toCqw(Math.max(0, figure.box[0] - previousRight) * ratio);
          previousRight = figure.box[2];
          placed.add(figure);
          wrapper.append(block);
        }
        paper.append(wrapper);
        previous = null;
      } else {
        const startsQuestion = item.kind === 'text' && /^[0-9０-９]{1,3}[.．、]\s*[\p{Script=Han}A-Za-z（(]/u.test(item.text ?? '');
        const text = item.kind === 'text' ? formatMarker(item.text ?? '', kind, template.markerWidth) : item.text ?? '';
        const startsOption = kind === 'option' && optionStart.test(item.text ?? '');
        const sameOptionRow = startsOption && previous && styleKind(previous.item) === 'option' && sameRow(previous.item.box, item.box) && x >= previous.item.box[2];
        if (!previous || (!sameOptionRow && (previous.item.group !== item.group || startsOption) && item.kind !== 'formula')
          || (previous.item.line !== item.line && startsQuestion)) {
          const paragraph = document.createElement('p');
          paragraph.className = 'template-block';
          applyStyle(paragraph, template, kind === 'formula' ? 'body' : kind, width, defaultSize, defaults);
          if (item.alignmentOverride) paragraph.style.textAlign = item.alignmentOverride;
          else if (titleGroups.has(item.group) && !resolveStyle(template, kind).alignment) paragraph.style.textAlign = 'center';
          const style = resolveStyle(template, kind);
          const indent = toCqw(Math.min(contentWidth * .22, Math.max(0, (x - sourceLeft) * flowScale)));
          if (paragraph.style.textAlign !== 'center') {
            if (['stem', 'option'].includes(kind) && style.leftIndentMm === undefined) paragraph.style.paddingInlineStart = indent;
            if (kind === 'body' && style.firstLineIndentMm === undefined) paragraph.style.textIndent = indent;
          }
          paper.append(paragraph);
          previous = { item, text: '', paragraph };
        }
        if (sameOptionRow) {
          const gap = document.createElement('span');
          gap.className = 'template-option-gap';
          gap.style.width = toCqw((x - previous.item.box[2]) * flowScale);
          previous.paragraph.append(gap);
        } else if (item.kind === 'text' && previous.item.kind === 'text' && /[A-Za-z0-9]$/.test(previous.text)
          && /^[A-Za-z0-9]/.test(text) && (previous.item.line !== item.line || x > previous.item.box[2] + 2)) {
          previous.paragraph.append(' ');
        }
        previous.item = item;
        previous.text = text;
        const ruleWidth = length => toCqw(length * flowScale);
        previous.paragraph.append(blank ? inlineRule(ruleWidth(x1 - x)) : element);
        for (const [left, , right] of rules.get(item.id) ?? []) {
          previous.paragraph.append(inlineRule(ruleWidth(right - left)));
          previous.text = '';
        }
      }
    }
    if (!flow) for (const { box } of page.rules ?? []) {
      const [left, top, right, bottom] = box;
      window.placePreviewRule(paper, [xOffset + left * scale, yOffset + top * scale,
        xOffset + right * scale, yOffset + bottom * scale], width, height);
    }
    if (template.footer) {
      const footer = document.createElement('p');
      footer.className = 'template-block template-footer';
      const pattern = template.footer === '{auto}' ? footerPattern ?? '第 {page} 页 / 共 {pages} 页' : template.footer;
      const footerText = pattern.replace(/\{(page|pages|file)\}/g, (_, token) => ({
        page: page.number, pages: pageCount ?? 1, file: filename ?? '物理练习卷',
      })[token]);
      appendStyledText(footer, footerText, template, 'footer');
      applyStyle(footer, template, 'footer', width, defaults.flowFontSizePt.footer, defaults);
      footer.style.bottom = pct(template.footerDistanceMm ?? defaults.footerDistanceMm ?? 5, height);
      if (flow) {
        footer.style.left = pct(left, width);
        footer.style.width = pct(contentWidth, width);
      }
      if (role === 'footer') footer.dataset.selected = '';
      paper.append(footer);
    }
    target.replaceChildren(paper);
    if (!flow) window.watchPreviewBounds(paper);
  };
})();
