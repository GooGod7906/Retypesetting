import type { Box } from './mineruLayout';
import type { TextStyle } from './layoutTemplate';

let converter: ((latex: string) => { svg: string; width: number; height: number }) | undefined;

function loadConverter() {
  const { mathjax } = require('mathjax-full/js/mathjax.js') as typeof import('mathjax-full/js/mathjax.js');
  const { TeX } = require('mathjax-full/js/input/tex.js') as typeof import('mathjax-full/js/input/tex.js');
  const { SVG } = require('mathjax-full/js/output/svg.js') as typeof import('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js') as typeof import('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js') as typeof import('mathjax-full/js/handlers/html.js');
  require('mathjax-full/js/input/tex/ams/AmsConfiguration.js');
  require('mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js');
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const input = new TeX({ packages: ['base', 'ams', 'boldsymbol'], maxBuffer: 8192, maxMacros: 250 });
  const document = mathjax.document('', { InputJax: input, OutputJax: new SVG({ fontCache: 'none' }) });
  return (latex: string) => {
    input.reset();
    const container = document.convert(latex, { display: false });
    const svg = adaptor.tags(container, 'svg')[0];
    if (!svg) throw new Error('公式没有可渲染的图形。');
    const viewBox = adaptor.getAttribute(svg, 'viewBox')?.split(/\s+/).map(Number);
    if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
      throw new Error('公式没有可渲染的边界框。');
    }
    const result = adaptor.outerHTML(svg);
    if (/data-mml-node=["']merror["']/.test(result)) throw new Error('公式包含无法识别的 LaTeX。');
    return { svg: result, width: viewBox[2], height: viewBox[3] };
  };
}

export function formulaGeometry(latex: string) {
  converter ??= loadConverter();
  return converter(latex);
}

export function renderFormulaImage(latex: string, box: Box, style: TextStyle = {}): { png: Buffer; box: Box } {
  const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js');
  const weight = style.bold ? `\\boldsymbol{${latex}}` : latex;
  const expression = style.underline ? `\\underline{${weight}}` : weight;
  const { svg, width, height } = formulaGeometry(expression);
  const [x, y, availableWidth, availableHeight] = box;
  const requestedScale = style.fontSizePt === undefined ? Infinity : style.fontSizePt * 12.7;
  const scale = Math.min(availableWidth / width, availableHeight / height, requestedScale);
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  const pixelScale = Math.min(1200 / Math.max(width, height), Math.max(48, targetWidth / 3600) / width);
  const pixels = (value: number) => Math.max(1, Math.ceil(value * pixelScale));
  const colored = style.color ? svg.replace(/="currentColor"/g, `="${style.color}"`) : svg;
  const absolute = colored.replace(/^<svg\b([^>]*)>/, (_match, attrs: string) => (
    `<svg${attrs.replace(/\s(?:width|height|style)="[^"]*"/g, '')} width="${pixels(width)}" height="${pixels(height)}">`
  ));
  const png = new Resvg(absolute, { font: { loadSystemFonts: false } }).render().asPng();
  return { png, box: [x, y + Math.round((availableHeight - targetHeight) / 2), targetWidth, targetHeight] };
}
