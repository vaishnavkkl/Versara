export const TOOL_HELP: Record<string, readonly [string, string, string]> = {
  viewer: ['Open a PDF from Recents or choose one from Files.', 'Tap a page thumbnail below the preview. Pinch to zoom.', 'Tap Toolbox for editing tools, vertical scrolling or saving a copy.'],
  edit_text: ['Tap the text you want to change. Use Text list if it is hard to select.', 'Type your change and check the live preview. Tap Apply.', 'Tap Save, then Save to device / share to choose where to keep the copy.'],
  text: ['Tap the page where you want new text.', 'Type, choose the size and check the preview. Tap Add text.', 'Tap Save to create your edited copy.'],
  remove_text: ['Tap the text you want to remove.', 'Tap Delete selected text. Undo brings it back.', 'Save a new copy. Text deletion is not secure redaction.'],
  merge: ['Choose two or more PDFs.', 'Put the files in the order you want.', 'Tap Merge, check the result and save your copy.'],
  split: ['Choose the PDF you want to separate.', 'Choose individual pages, groups or a page range, such as 1-3.', 'Create the new PDFs, then open or save them.'],
  extract: ['Choose your PDF.', 'Select the pages to keep, such as 1, 3-5.', 'Create and save a new PDF with only those pages.'],
  delete: ['Choose your PDF.', 'Select the pages to remove. Check the remaining page count.', 'Create and save a new copy. Your original stays unchanged.'],
  reorder: ['Choose your PDF.', 'Move pages into the order you want.', 'Check the new order, then create and save your copy.'],
  rotate: ['Choose your PDF and select pages.', 'Choose which way to turn them.', 'Create the PDF, check the result and save it.'],
  from_image: ['Choose one or more images.', 'Arrange them and choose a page size.', 'Tap Create PDF, then open or save the result.'],
};
