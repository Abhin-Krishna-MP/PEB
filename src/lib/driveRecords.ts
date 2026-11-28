import { type Annotation, type Book, type Collection } from './model'
import { samples } from './samples'

export type BookDetails = Omit<Book, 'annotations' | 'page' | 'openedAt' | 'driveFile'>
type Position = Pick<Book, 'page' | 'openedAt'>
type Change =
  | { kind: 'book'; id: string; value: BookDetails | null }
  | { kind: 'position'; id: string; value: Position }
  | { kind: 'annotation'; id: string; annotation: string; value: Annotation | null }
  | { kind: 'collection'; id: string; value: Collection | null }
export type DriveRecord = Change & { key: string; clock: number; device: string }
export type DriveBinding = { account: string; device: string }

export function bookDetails({ annotations, page, openedAt, driveFile, ...details }: Book): BookDetails {
  return details
}

export function recordKey(change: Change) {
  return change.kind + '/' + change.id + (change.kind === 'annotation' ? '/' + change.annotation : '')
}

export function recordsForBook(book: Book, previous?: Book): Change[] {
  const changes: Change[] = []
  const details = bookDetails(book)
  if (!previous || JSON.stringify(bookDetails(previous)) !== JSON.stringify(details)) changes.push({ kind: 'book', id: book.id, value: details })
  if (!previous || book.page !== previous.page) changes.push({ kind: 'position', id: book.id, value: { page: book.page, openedAt: book.openedAt } })
  if (book.annotations !== previous?.annotations) {
    const old = new Map(previous?.annotations.map(item => [item.id, item]))
    for (const entry of book.annotations) {
      if (JSON.stringify(old.get(entry.id)) !== JSON.stringify(entry)) changes.push({ kind: 'annotation', id: book.id, annotation: entry.id, value: entry })
      old.delete(entry.id)
    }
    for (const id of old.keys()) changes.push({ kind: 'annotation', id: book.id, annotation: id, value: null })
  }
  return changes
}

export function newer(candidate: DriveRecord, previous?: DriveRecord) {
  return !previous || candidate.clock > previous.clock || (candidate.clock === previous.clock && candidate.device > previous.device)
}

export function mergeDriveRecords(...sources: DriveRecord[][]) {
  const merged = new Map<string, DriveRecord>()
  for (const records of sources) {
    for (const record of records) {
      if (newer(record, merged.get(record.key))) merged.set(record.key, record)
    }
  }
  return [...merged.values()].sort((a, b) => a.key < b.key ? -1 : a.key === b.key ? 0 : 1)
}

const localSamples = new Map(samples.map(book => [book.id, book]))
export const isRecordId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const integer = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min
function validObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseDriveRecords(data: unknown): DriveRecord[] {
  if (!validObject(data) || data.version !== 1 || !Array.isArray(data.records)) throw new Error('A Folio sync file uses an unsupported format.')
  const records: DriveRecord[] = []
  for (const row of data.records) {
    if (!validObject(row) || !isRecordId(row.id) || !isRecordId(row.device) || !integer(row.clock, 1) || row.clock >= Number.MAX_SAFE_INTEGER) continue
    const { kind, value } = row
    let change: Change | undefined
    if (kind === 'book') {
      if (value === null) change = { kind, id: row.id, value }
      else if (validObject(value) && text(value.title, 500) && text(value.category, 200) &&
          integer(value.pages, 1) && integer(value.size) && integer(value.createdAt) && typeof value.favorite === 'boolean' &&
          (value.sample === undefined || value.sample === localSamples.get(row.id)?.sample)) {
        const cover = text(value.cover, 2_000_000) && /^data:image\/(?:png|jpeg|webp);base64,[\w+/=]+$/.test(value.cover)
          ? value.cover : localSamples.get(row.id)?.cover ?? ''
        change = { kind, id: row.id, value: {
          id: row.id, title: value.title, category: value.category, pages: value.pages, size: value.size,
          createdAt: value.createdAt, favorite: value.favorite, cover,
          sample: localSamples.get(row.id)?.sample, art: integer(value.art) ? value.art : undefined,
          aspectRatio: typeof value.aspectRatio === 'number' && value.aspectRatio > 0 && Number.isFinite(value.aspectRatio) ? value.aspectRatio : undefined,
          collectionId: isRecordId(value.collectionId) ? value.collectionId : undefined,
        } }
      }
    } else if (kind === 'position' && validObject(value) && integer(value.page, 1) && integer(value.openedAt)) {
      change = { kind, id: row.id, value: { page: value.page, openedAt: value.openedAt } }
    } else if (kind === 'collection') {
      if (value === null) change = { kind, id: row.id, value }
      else if (validObject(value) && text(value.name, 100)) change = { kind, id: row.id, value: { id: row.id, name: value.name } }
    } else if (kind === 'annotation' && isRecordId(row.annotation)) {
      if (value === null) change = { kind, id: row.id, annotation: row.annotation, value }
      else if (validObject(value) && integer(value.page, 1) && text(value.text, 100_000) &&
          (value.kind === 'bookmark' || value.kind === 'note' || value.kind === 'highlight')) {
        const boxes = Array.isArray(value.boxes) ? value.boxes.filter(
          box => validObject(box) && ['x', 'y', 'width', 'height'].every(key => typeof box[key] === 'number' && Number.isFinite(box[key])),
        ) as Annotation['boxes'] : undefined
        change = { kind, id: row.id, annotation: row.annotation, value: { id: row.annotation, page: value.page, kind: value.kind, text: value.text, boxes } }
      }
    }
    if (change) records.push({ ...change, key: recordKey(change), clock: row.clock, device: row.device })
  }
  return records
}
