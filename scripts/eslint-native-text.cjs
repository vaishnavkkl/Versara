// Inline JSX whitespace is a text child too; native layout views reject it.
const containers = new Set(['View', 'ScrollView', 'Pressable', 'TouchableOpacity', 'KeyboardAvoidingView', 'SafeAreaView', 'PdfPreviewFooter', 'PdfPreviewStage', 'PdfPreviewToolbar']);
function isLayoutChild(node) {
  let parent = node.parent;
  while (parent?.type === 'JSXFragment') parent = parent.parent;
  const name = parent?.type === 'JSXElement' ? parent.openingElement.name : null;
  return name?.type === 'JSXIdentifier' && containers.has(name.name);
}
module.exports = {
  meta: { type: 'problem', schema: [], messages: { raw: 'Native layout children cannot be raw text, including inline spaces. Remove spacing text or wrap visible text in ThemedText/Text.' } },
  create(context) {
    return {
      JSXText(node) {
        if (isLayoutChild(node) && (node.value.trim() || !/[\r\n]/.test(node.value) && node.value.length)) context.report({ node, messageId: 'raw' });
      },
      JSXExpressionContainer(node) {
        const value = node.expression;
        if (isLayoutChild(node) && value.type === 'Literal' && (typeof value.value === 'number' || typeof value.value === 'string' && value.value.length)) context.report({ node, messageId: 'raw' });
      },
    };
  },
};
