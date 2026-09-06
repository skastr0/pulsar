export type { Project } from "tsgo-typescript/unstable/async"
export type {
  ArrowFunction,
  Block,
  CallExpression,
  CatchClause,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  MethodDeclaration,
  ModifierLike,
  Node,
  ParameterDeclaration,
  PropertyAccessExpression,
  PropertyDeclaration,
  SourceFile,
  VariableDeclaration,
  VoidExpression,
} from "tsgo-typescript/unstable/ast"
export { SyntaxKind } from "tsgo-typescript/unstable/ast"
export {
  isArrowFunction,
  isBlock,
  isCallExpression,
  isCatchClause,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isPropertyAccessExpression,
  isPropertyDeclaration,
  isSourceFile,
  isVariableDeclaration,
  isVoidExpression,
} from "tsgo-typescript/unstable/ast/is"
export { forEachLeadingCommentRange } from "tsgo-typescript/unstable/ast/scanner"
export { isMethodSignatureDeclaration as isMethodSignature } from "tsgo-typescript/unstable/ast/is"
export type { MethodSignatureDeclaration as MethodSignature } from "tsgo-typescript/unstable/ast"
