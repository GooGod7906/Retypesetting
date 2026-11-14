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

  function styleKind(item) {
    if (['formula', 'table'].includes(item.kind)) return item.kind;
    if (item.roleOverride) return item.roleOverride;
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
      if (template.mode === 'flow' && item.kind === 'text') {
        for (const part of text.split(/([_＿]{2,})/u)) {
          element.append(/^[_＿]{2,}$/u.test(part)
            ? inlineRule([...part].reduce((width, character) => width + (character === '＿' ? 1 : 0.5), 0) + 'em')
            : part);
        }
      } else element.textContent = text;
    }
  }

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
    const own = template.styles[role];
    const style = { font: template.font, ...(own?.inheritBody === false ? {} : template.styles.body), ...own };
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
    for (const item of items) { item.style.fontSize = ''; item.style.transform = ''; }
    const measurements = items.map(item => {
      const frame = item.parentElement;
      const size = parseFloat(getComputedStyle(item).fontSize);
      const factor = Math.min(1, frame.clientWidth / Math.max(1, item.scrollWidth), frame.clientHeight / Math.max(1, item.scrollHeight));
      return [item, size * factor, Math.min(1, frame.clientWidth / Math.max(1, item.scrollWidth))];
    });
    for (const [item, size, scale] of measurements) {
      if (item.parentElement.hasAttribute('data-uniform-text')) item.style.transform = `scaleX(${scale})`;
      else item.style.fontSize = `${size}px`;
    }
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

  window.renderTemplatePreview = function (target, { template, defaults, page = sample, assetPath, role, pageCount, filename }) {
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
    const pct = (value, reference) => `${value / reference * 100}%`;
    const styles = [top, right, bottom, left].map(value => pct(value, width));
    if (flow) paper.style.padding = styles.join(' ');
    const rules = new Map();
    for (const rule of page.rules ?? []) {
      const attached = rules.get(rule.after) ?? [];
      attached.push(rule.box);
      rules.set(rule.after, attached);
    }
    let previous = null;
    for (const item of page.items) {
      const kind = styleKind(item);
      if ((kind === 'footer' && template.footer) || (!template.showPageMarks && ['header', 'footer'].includes(kind))) continue;
      const [x, y, x1, y1] = item.box;
      const standalone = item.kind === 'image' || item.kind === 'table';
      const element = document.createElement(flow && !standalone ? 'span' : 'div');
      element.className = `template-block${standalone ? ' template-figure' : ''}`;
      if (kind === role) element.dataset.selected = '';
      const uniform = !flow && ['body', 'stem', 'option'].includes(kind);
      if (uniform) element.dataset.uniformText = '';
      const defaultSize = uniform ? defaults.fixedBodyFontSizePt ?? defaults.flowFontSizePt.body
        : flow ? defaults.flowFontSizePt[item.level === 1 ? 'heading1' : item.level ? 'heading' : 'body']
        : Math.min(26, Math.max(5, (y1 - y) * scale * 72 / 25.4 * 0.82));
      const content = flow || standalone ? element : document.createElement('span');
      applyStyle(element, template, kind, width, defaultSize, defaults);
      const blank = flow && item.kind === 'text' && /^[_＿]+$/.test(item.text ?? '');
      if (!blank) renderContent(content, item, template, assetPath);
      if (item.crop && flow && template.formulaMode !== 'latex') content.firstElementChild.style.width = `${(x1 - x) * scale / width * 100}cqw`;
      if (!flow) {
        Object.assign(element.style, { position: 'absolute', left: pct(xOffset + x * scale, width), top: pct(yOffset + y * scale, height),
          width: pct((x1 - x) * scale, width), height: pct((y1 - y) * scale, height) });
        element.classList.add('bounded-preview');
        if (content !== element) {
          content.className = 'bounded-content';
          element.append(content);
        }
        paper.append(element);
      } else if (standalone) {
        element.style.width = pct(Math.min(contentWidth, (x1 - x) * scale), contentWidth);
        element.style.minHeight = `${(y1 - y) * scale / width * 100}cqw`;
        paper.append(element);
        previous = null;
      } else {
        const startsQuestion = item.kind === 'text' && /^\d{1,3}[.．、]\s*[\p{Script=Han}（(]/u.test(item.text ?? '');
        if (!previous || previous.item.group !== item.group || kind === 'option'
          || (previous.item.line !== item.line && startsQuestion)) {
          const paragraph = document.createElement('p');
          paragraph.className = 'template-block';
          applyStyle(paragraph, template, kind === 'formula' ? 'body' : kind, width, defaultSize, defaults);
          paper.append(paragraph);
          previous = { item, text: '', paragraph };
        }
        if (item.kind === 'text' && previous.item.kind === 'text' && /[A-Za-z0-9]$/.test(previous.text)
          && /^[A-Za-z0-9]/.test(item.text ?? '') && (previous.item.line !== item.line || x > previous.item.box[2] + 2)) {
          previous.paragraph.append(' ');
        }
        previous.item = item;
        previous.text = item.text ?? '';
        const ruleWidth = length => pct(length * scale, width).replace('%', 'cqw');
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
      footer.textContent = template.footer.replace(/\{(page|pages|file)\}/g, (_, token) => ({
        page: page.number, pages: pageCount ?? 1, file: filename ?? '物理练习卷',
      })[token]);
      applyStyle(footer, template, 'footer', width, defaults.flowFontSizePt.footer, defaults);
      if (role === 'footer') footer.dataset.selected = '';
      paper.append(footer);
    }
    target.replaceChildren(paper);
    if (!flow) window.watchPreviewBounds(paper);
  };
})();
