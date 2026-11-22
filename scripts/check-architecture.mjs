import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(file));
    else if (/\.tsx?$/.test(file)) result.push(file);
  }
  return result;
}

const files = await collect('src'), known = new Set(files), graph = new Map(), errors = [];
for (const file of files) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const dependencies = new Set();
  const check = (specifier) => {
    if (!specifier.startsWith('.')) return;
    const base = normalize(join(dirname(file), specifier));
    const target = [base, base + '.ts', base + '.tsx'].find(p => known.has(p));
    if (!target) { if (!specifier.endsWith('.css')) errors.push(`${file}: không tìm thấy ${specifier}`); return; }
    dependencies.add(target);
    if (file.startsWith('src/shared/') && !target.startsWith('src/shared/')) errors.push(`${file}: shared phụ thuộc ${target}`);
    const feature = file.match(/^src\/features\/([^/]+)\//)?.[1];
    const targetFeature = target.match(/^src\/features\/([^/]+)\//)?.[1];
    if (feature && (target.startsWith('src/app/') || (targetFeature && feature !== targetFeature))) errors.push(`${file}: vượt ranh giới feature tới ${target}`);
    if (file.includes('/models/') && /\/(services|controllers|views)\//.test(target)) errors.push(`${file}: model phụ thuộc implementation ${target}`);
  };
  const visit = n => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) check(n.moduleSpecifier.text);
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) check(n.argument.literal.text);
    ts.forEachChild(n, visit);
  };
  visit(source); graph.set(file, dependencies);
}

// Kiểm tra cả import kiểu dữ liệu: DTO không được tạo vòng tham chiếu service.
const done = new Set(), active = new Set();
function visit(file, trail = []) {
  if (active.has(file)) { errors.push('Vòng dependency: ' + [...trail, file].join(' → ')); return; }
  if (done.has(file)) return;
  active.add(file);
  for (const target of graph.get(file) ?? []) visit(target, [...trail, file]);
  active.delete(file); done.add(file);
}
for (const file of files) visit(file);
if (errors.length) throw new Error(errors.join('\n'));
console.log(`PASS: ${files.length} source/test modules; không có vòng dependency, shared/feature/model đúng ranh giới.`);
