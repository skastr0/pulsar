import {
  isArrowFunction,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isSetAccessorDeclaration,
  type ArrowFunction,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type GetAccessorDeclaration,
  type MethodDeclaration,
  type Node,
  type SetAccessorDeclaration,
} from "../tsgo-api.js"
import { textOf } from "../ast.js"

export type CompilerFunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

export const isCompilerFunctionLike = (node: Node): node is CompilerFunctionLike =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node) ||
  isConstructorDeclaration(node) ||
  isGetAccessorDeclaration(node) ||
  isSetAccessorDeclaration(node)

export const compilerPropertyNameText = (name: Node): string => {
  if (isIdentifier(name)) return name.text
  return textOf(name)
}
