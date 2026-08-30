// Development/test-only syntax inspection. Node ships Acorn for its own REPL.
// Fail explicitly if that inspected runtime facility is unavailable; never
// download a parser, evaluate application source, or ship this helper to users.
const vm = require('node:vm');
const parserSource = process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
if (typeof parserSource !== 'string') throw new Error(`Bundled Acorn unavailable in ${process.version}`);
const parserExports = {};
vm.runInNewContext(parserSource, { exports: parserExports, module: { exports: parserExports } }, { timeout: 5000 });
const parse = source => parserExports.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });

class Scope {
  constructor(parent, functionScope = false) {
    this.parent = parent;
    this.names = new Set();
    this.functionScope = functionScope || !parent ? this : parent.functionScope;
  }
  has(name) { return this.names.has(name) || !!this.parent?.has(name); }
}

// Resolve lexical declarations before deciding which references are free.
// This handles nested/shadowed bindings, destructuring and computed property
// keys rather than mistaking every matching identifier/string for a dependency.
function freeNames(node) {
  const root = new Scope(null, true);
  const references = [];
  function binding(pattern, scope, evaluationScope = scope) {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier': scope.names.add(pattern.name); return;
      case 'RestElement': binding(pattern.argument, scope, evaluationScope); return;
      case 'AssignmentPattern': binding(pattern.left, scope, evaluationScope); walk(pattern.right, evaluationScope); return;
      case 'ArrayPattern': pattern.elements.forEach(value => binding(value, scope, evaluationScope)); return;
      case 'ObjectPattern':
        for (const property of pattern.properties) {
          if (property.type === 'RestElement') binding(property.argument, scope, evaluationScope);
          else { if (property.computed) walk(property.key, evaluationScope); binding(property.value, scope, evaluationScope); }
        }
        return;
      default: throw new Error(`Unsupported binding: ${pattern.type}`);
    }
  }
  function generic(value, scope) {
    for (const [key, child] of Object.entries(value)) {
      if (['loc', 'start', 'end'].includes(key)) continue;
      if (Array.isArray(child)) child.forEach(item => { if (item?.type) walk(item, scope); });
      else if (child?.type) walk(child, scope);
    }
  }
  function walk(value, scope) {
    if (!value) return;
    switch (value.type) {
      case 'Identifier': references.push({ name: value.name, scope }); return;
      case 'PrivateIdentifier': case 'Literal': case 'TemplateElement': case 'ThisExpression': case 'Super':
      case 'EmptyStatement': case 'DebuggerStatement': case 'MetaProperty': return;
      case 'Program': value.body.forEach(item => walk(item, scope)); return;
      case 'BlockStatement': {
        const block = new Scope(scope); value.body.forEach(item => walk(item, block)); return;
      }
      case 'VariableDeclaration':
        for (const declaration of value.declarations) {
          binding(declaration.id, value.kind === 'var' ? scope.functionScope : scope, scope);
          walk(declaration.init, scope);
        }
        return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        if (value.type === 'FunctionDeclaration' && value.id) scope.names.add(value.id.name);
        const fn = new Scope(scope, true);
        if (value.id) fn.names.add(value.id.name);
        if (value.type !== 'ArrowFunctionExpression') fn.names.add('arguments');
        value.params.forEach(parameter => binding(parameter, fn));
        walk(value.body, fn); return;
      }
      case 'ClassDeclaration': case 'ClassExpression': {
        if (value.type === 'ClassDeclaration' && value.id) scope.names.add(value.id.name);
        walk(value.superClass, scope);
        const cls = new Scope(scope);
        if (value.id) cls.names.add(value.id.name);
        walk(value.body, cls); return;
      }
      case 'MemberExpression':
        walk(value.object, scope); if (value.computed) walk(value.property, scope); return;
      case 'Property': case 'MethodDefinition': case 'PropertyDefinition':
        if (value.computed) walk(value.key, scope); walk(value.value, scope); return;
      case 'CatchClause': {
        const caught = new Scope(scope); binding(value.param, caught); walk(value.body, caught); return;
      }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': case 'SwitchStatement':
        generic(value, new Scope(scope)); return;
      case 'LabeledStatement': walk(value.body, scope); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'WithStatement': throw new Error('Dynamic with scope is prohibited in extracted renderers');
      default: generic(value, scope);
    }
  }
  walk(node, root);
  return [...new Set(references.filter(reference => !reference.scope.has(reference.name)).map(reference => reference.name))].sort();
}

function rendererDeclarations(source) {
  const ast = parse(source);
  const renderer = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id?.name === 'renderPayNewBatchWizard');
  if (!renderer) throw new Error('Current Banking Pay renderer missing');
  const declarations = new Map();
  for (const statement of renderer.body.body) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declaration of statement.declarations) {
      if (declaration.id.type !== 'Identifier') throw new Error('Review destructured renderer declaration before extraction');
      const name = declaration.id.name;
      if (declarations.has(name)) throw new Error(`Duplicate outer declaration: ${name}`);
      declarations.set(name, { name, node: declaration.init, statement,
        source: source.slice(statement.start, statement.end),
        isFunction: ['ArrowFunctionExpression', 'FunctionExpression'].includes(declaration.init?.type) });
    }
  }
  return declarations;
}
module.exports = { parse, freeNames, rendererDeclarations };
