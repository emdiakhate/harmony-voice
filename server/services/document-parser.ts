import fs from 'fs';
import path from 'path';

/**
 * Extract text content from a document file (PDF, DOCX, TXT).
 */
export async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.pdf') {
    return extractFromPdf(filePath);
  } else if (ext === '.docx' || ext === '.doc') {
    return extractFromDocx(filePath);
  } else if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }

  throw new Error(`Format de fichier non supporté: ${ext}. Formats acceptés: PDF, DOCX, TXT`);
}

async function extractFromPdf(filePath: string): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();

  if (!result.text || result.text.trim().length === 0) {
    throw new Error('Aucun texte trouvé dans le PDF. Le fichier est peut-être un scan/image.');
  }

  console.log(`[DocParser] PDF: ${result.total} pages, ${result.text.length} chars`);
  return result.text.trim();
}

async function extractFromDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });

  if (!result.value || result.value.trim().length === 0) {
    throw new Error('Aucun texte trouvé dans le document Word.');
  }

  console.log(`[DocParser] DOCX: ${result.value.length} chars`);
  return result.value.trim();
}
