import { PDFDocument, PDFName, PDFHexString, StandardFonts, rgb } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

const books = [
  ['algorithms', 'Algorithms & Data Structures', 48, ['Growth and complexity', 'Linear data structures', 'Trees and traversal', 'Graph algorithms', 'Sorting and selection', 'Dynamic programming']],
  ['database', 'Database Systems', 24, ['The relational model', 'Queries and joins', 'Indexes and access paths', 'Transactions']],
  ['operating', 'Operating Systems', 32, ['Processes and threads', 'Scheduling', 'Virtual memory', 'Files and storage']],
  ['networks', 'Computer Networks', 28, ['Layered protocols', 'Routing and addressing', 'Reliable transport', 'Network applications']],
  ['discrete', 'Discrete Mathematics', 20, ['Logic and proofs', 'Sets and functions', 'Counting', 'Graph theory']],
  ['compiler', 'Compiler Design', 24, ['Lexical analysis', 'Parsing', 'Intermediate representations', 'Code generation']],
]

const algorithmNotes = [
  ['Asymptotic growth', 'Compare algorithms by the rate at which resource usage grows. An upper bound O(f(n)) says that beyond a threshold, a constant multiple of f(n) bounds the cost.'],
  ['Arrays and lists', 'Arrays support constant-time indexed access. Linked lists use references between nodes and allow insertion once the predecessor is known.'],
  ['Binary search trees', 'An in-order traversal of a binary search tree visits keys in sorted order. Searching follows the comparisons from the root to a leaf. The depth of the tree bounds the work.'],
  ['Breadth-first search', 'Breadth-first search (BFS) visits vertices in increasing distance from a starting vertex. A queue records discovered vertices whose neighbors remain unexplored.'],
  ['Partitioning', 'Quicksort partitions a sequence around a pivot. A partition establishes which elements belong on each side before either side is sorted recursively.'],
  ['Overlapping subproblems', 'Dynamic programming saves the results of repeated subproblems. A recurrence specifies how smaller results combine, and an evaluation order makes dependencies available.'],
]

const ink = rgb(0.12, 0.15, 0.19)
const muted = rgb(0.38, 0.37, 0.34)
const gold = rgb(0.55, 0.36, 0.21)
for (const [slug, title, count, chapters] of books) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setAuthor('Folio Editions')
  const [serif, bold, sans] = await Promise.all([StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.Helvetica].map(font => pdf.embedFont(font)))
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage([460, 625])
    const chapter = Math.floor(i / count * chapters.length)
    const [topic, text] = slug === 'algorithms' ? algorithmNotes[chapter] : [chapters[chapter], 'Use this sample to explore the reader. Try selecting a passage, marking a page, or moving between spreads.']
    const line = (value, x, y, font = serif, size = 12, color = ink) => {
      page.drawText(value, { x, y, font, size, color, maxWidth: 366, lineHeight: size * 1.5 })
    }
    page.drawRectangle({ x: 0, y: 0, width: 460, height: 625, color: rgb(0.995, 0.982, 0.95) })
    line('FOLIO EDITIONS  /  READING ROOM', 46, 576, sans, 8, gold)
    page.drawLine({ start: { x: 46, y: 560 }, end: { x: 414, y: 560 }, thickness: 0.6, color: gold })
    if (i === 0) {
      line(title.replace(' & ', ' &\n'), 46, 455, bold, 35)
      line('An introductory companion', 46, 335, serif, 16, muted)
    } else {
      line('CHAPTER ' + (chapter + 1), 46, 520, sans, 9, gold)
      line(chapters[chapter], 46, 485, bold, 27)
      line(topic, 46, 438, bold, 16)
      line(text, 46, 408)
      const nodes = [[105,252],[194,306],[287,280],[339,226],[220,210]]
      const edges = [[0,1],[1,2],[2,3],[2,4],[0,4],[3,4]]
      for (const [a,b] of edges) page.drawLine({ start: { x:nodes[a][0], y:nodes[a][1] }, end: { x:nodes[b][0], y:nodes[b][1] }, thickness: 1, color: gold })
      for (const [[x, y], index] of nodes.map((point, n) => [point, n])) {
        page.drawCircle({ x, y, size: 13, color: rgb(0.98, 0.95, 0.89), borderColor: gold, borderWidth: 0.8 })
        line(String.fromCharCode(65 + index), x - 3, y - 3, sans, 9)
      }
      line('Figure ' + (chapter + 1) + '. A small example with five connected elements.', 46, 175, serif, 10, muted)
      line('Reading exercise', 46, 130, bold, 13)
      line('Describe how changing one connection affects the rest of the example.', 46, 106, serif, 11)
    }
    line(String(i + 1).padStart(2, '0'), 46, 43, sans, 9, gold)
  }
  const pages = pdf.getPages()
  const outlineRef = pdf.context.nextRef()
  const chapterRefs = chapters.map(() => pdf.context.nextRef())
  chapters.forEach((chapter, index) => {
    const first = Math.max(1, Math.ceil(index * count / chapters.length))
    const entry = pdf.context.obj({
      Title: PDFHexString.fromText(chapter),
      Parent: outlineRef,
      Dest: [pages[first].ref, PDFName.of('Fit')],
    })
    if (index > 0) entry.set(PDFName.of('Prev'), chapterRefs[index - 1])
    if (index + 1 < chapters.length) entry.set(PDFName.of('Next'), chapterRefs[index + 1])
    pdf.context.assign(chapterRefs[index], entry)
  })
  pdf.context.assign(outlineRef, pdf.context.obj({
    Type: PDFName.of('Outlines'), First: chapterRefs[0], Last: chapterRefs.at(-1), Count: chapters.length,
  }))
  pdf.catalog.set(PDFName.of('Outlines'), outlineRef)
  pdf.setCreationDate(new Date('2025-01-10T00:00:00Z'))
  pdf.setModificationDate(new Date('2025-01-10T00:00:00Z'))
  await writeFile(`public/samples/${slug}.pdf`, await pdf.save())
}
