import assert from 'node:assert/strict';
import { findMathMatches } from '../src/math-matches.js';

for (const source of ['$3.613B，即36.13亿美元，人才约$210M。', '预算 $350k-$550k，后续 $70.55M。', '$599 [竞-06]，预订 $450。', '\\$5 和 \\$10。', '$ a $，$b $，$c$20']) {
  assert.deepEqual(findMathMatches(source), [], source);
}
assert.deepEqual(findMathMatches('价格 $10 and $x^2$，公式 $E=mc^2$。').map((match) => match.tex), ['x^2', 'E=mc^2']);
assert.deepEqual(findMathMatches('$2+2=4$ 和 $42$，\\(a+b\\)，$$\n\\frac{1}{2}\n$$').map(({ tex, display }) => ({ tex, display })), [
  { tex: '2+2=4', display: false }, { tex: '42', display: false }, { tex: 'a+b', display: false }, { tex: '\n\\frac{1}{2}\n', display: true },
]);
assert.deepEqual(findMathMatches('$$a+b$$', { display: false }), []);
console.log('Currency and math delimiter checks passed');
