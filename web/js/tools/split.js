import { baseName, busyText, openPdfLib, openPdfjs, parseRange, readBytes, savePdf, simpleTool } from '../core.js';

async function pagesToPdf(src, indices) {
  const out = await PDFLib.PDFDocument.create();
  (await out.copyPages(src, indices)).forEach((p) => out.addPage(p));
  return savePdf(out);
}

/** Top-level bookmarks → page indices where each chapter starts. */
async function chapterStarts(bytes, name) {
  const doc = await openPdfjs(bytes, name);
  const outline = (await doc.getOutline()) || [];
  const starts = [];
  for (const item of outline) {
    try {
      let dest = item.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!dest) continue;
      const idx = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0];
      starts.push({ idx, title: item.title });
    } catch { /* ignore broken bookmarks */ }
  }
  return starts.sort((a, b) => a.idx - b.idx);
}

export function mount(root, tool) {
  simpleTool(root, {
    tool,
    manyOutputs: true,
    actionLabel: 'Split PDF',
    busyText: 'Splitting…',
    fields: [
      { name: 'mode', label: 'How should I split it?', type: 'select', value: 'each', options: [
        ['each', 'Every page into its own PDF'], ['n', 'Every N pages'], ['ranges', 'By page ranges'],
        ['at', 'Split after specific pages'], ['oddeven', 'Odd and even pages'], ['half', 'In two halves'],
        ['bookmarks', 'By chapters (top-level bookmarks)']] },
      { name: 'n', label: 'Pages per file', type: 'number', value: 2, min: 1, show: (v) => v.mode === 'n' },
      { name: 'ranges', label: 'Ranges (one file each)', type: 'text', placeholder: 'e.g. 1-3; 4-10; 11-', hint: 'Separate files with ; — within a file use commas, e.g. 1-2,5; 3-4', show: (v) => v.mode === 'ranges' },
      { name: 'at', label: 'Split after page(s)', type: 'text', placeholder: 'e.g. 3, 7', show: (v) => v.mode === 'at' },
    ],
    async run([file], v) {
      const bytes = await readBytes(file);
      const src = await openPdfLib(bytes, file.name);
      const count = src.getPageCount();
      const name = baseName(file.name);
      const all = [...Array(count).keys()];
      let groups = [];
      switch (v.mode) {
        case 'each': groups = all.map((i) => ({ idx: [i], label: `page${i + 1}` })); break;
        case 'n': {
          const n = Math.max(1, Math.floor(v.n || 1));
          for (let i = 0; i < count; i += n) groups.push({ idx: all.slice(i, i + n), label: `pages${i + 1}-${Math.min(count, i + n)}` });
          break;
        }
        case 'ranges':
          groups = (v.ranges || '').split(';').map((s) => s.trim()).filter(Boolean)
            .map((s) => ({ idx: parseRange(s, count), label: `pages${s.replace(/[^0-9-]+/g, '_')}` }));
          if (!groups.length) throw new Error('Please type some ranges, e.g. 1-3; 4-6');
          break;
        case 'at': {
          const cuts = [...new Set(parseRange(v.at || '', count))].sort((a, b) => a - b).filter((i) => i < count - 1);
          let prev = 0;
          for (const c of [...cuts, count - 1]) { groups.push({ idx: all.slice(prev, c + 1), label: `pages${prev + 1}-${c + 1}` }); prev = c + 1; }
          break;
        }
        case 'oddeven':
          groups = [{ idx: all.filter((i) => i % 2 === 0), label: 'odd' }, { idx: all.filter((i) => i % 2 === 1), label: 'even' }].filter((g) => g.idx.length);
          break;
        case 'half': {
          const m = Math.ceil(count / 2);
          groups = [{ idx: all.slice(0, m), label: 'part1' }, { idx: all.slice(m), label: 'part2' }].filter((g) => g.idx.length);
          break;
        }
        case 'bookmarks': {
          const starts = await chapterStarts(bytes, file.name);
          if (!starts.length) throw new Error('This PDF has no bookmarks to split by 🙀');
          if (starts[0].idx > 0) starts.unshift({ idx: 0, title: 'start' });
          starts.forEach((s, k) => {
            const end = k + 1 < starts.length ? starts[k + 1].idx : count;
            if (end > s.idx) groups.push({ idx: all.slice(s.idx, end), label: s.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || `part${k + 1}` });
          });
          break;
        }
        default:
      }
      const outputs = [];
      for (const [k, g] of groups.entries()) {
        busyText(`Writing file ${k + 1} of ${groups.length}…`);
        outputs.push({ name: `${name}-${g.label}.pdf`, data: await pagesToPdf(src, g.idx), type: 'application/pdf' });
      }
      return outputs;
    },
  });
}
