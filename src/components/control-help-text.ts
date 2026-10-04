const explanations: Record<string, string> = {
  options: 'Choose file settings and advanced options for this tool.',
  style: 'Change the font, size, colour, or appearance of the selected item.',
  search: 'Find text in this PDF and jump to a matching text box.',
  'previous page': 'Show the page before the current page.',
  'next page': 'Show the page after the current page.',
  undo: 'Revert the most recent edit in this session.',
  redo: 'Restore the edit you most recently undid.',
  'fit page': 'Reset the zoom so the whole page fits in the preview.',
  'fit pdf page': 'Reset the zoom so the whole page fits in the preview.',
  'add text': 'Tap the page to place a new text box.',
  'select text': 'Tap existing text on the page to select it.',
  'text list': 'List text fragments on the current page so you can select one.',
  'select all': 'Select every available page or item in this tool.',
  'clear selection': 'Unselect the currently selected items.',
  'apply text': 'Commit the change to the selected text box.',
  'cancel selection': 'Close the current text box without applying its draft.',
  'estimate size': 'Estimate the output size using the current compression quality.',
  'add pdfs': 'Choose more PDFs to include in the merge.',
  'merge pdfs': 'Create a PDF from the selected files in their displayed order.',
  'reverse order': 'Reverse the current page order.',
  'reset order': 'Restore the original page order.',
  'new pdf name': 'Set the name of the PDF this operation creates.',
};

export function controlHelpText(label: string, disabled: boolean) {
  const explanation = explanations[label.trim().toLowerCase().replace(/, show options$/, '')];
  return `${label}${explanation ? '\n' + explanation : ''}${disabled ? '\nUnavailable in the current state.' : ''}`;
}
