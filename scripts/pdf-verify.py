"""Check exported PDF text independently with pypdf (optional QA dependency)."""
import argparse
import json
import re
from pathlib import Path
from pypdf import PdfReader

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', default='test-fixtures/results/native/pdf-qa/pdf-report.json')
parser.add_argument('--long')
parser.add_argument('--source', default='test-fixtures/ai-report.md')
args = parser.parse_args()
report = json.loads(Path(args.report).read_text(encoding='utf-8'))
results = []

def compact(value):
    return re.sub(r'\s+', '', value)

for item in report['exports']:
    pdf = PdfReader(item['artifact'])
    text = '\n'.join(page.extract_text() for page in pdf.pages)
    assert len(pdf.pages) == item['pages']
    assert len(text.strip()) > 20, f"Empty/unselectable PDF: {item['file']}"
    assert '最近文档' not in text and '阅读偏好' not in text
    name = Path(item['file']).name
    if name == '中文技术长文.md':
        for expected in ['中文技术长文', '打开文档', '持续阅读', '写回原文件', '第一层', '第二层', '第三层']:
            assert expected in text, f'Missing Chinese text: {expected}'
        assert '$a^2+b^2=c^2$' not in text
    if name == '公式与金额边界.md':
        for expected in ['$350k-$550k', '$3.613B', '$210M', '$literal$', '$x^2$']:
            assert expected in compact(text), f'Currency/code changed: {expected}'
    if name == '跨页表格与长代码.md':
        for expected in ['第100行', 'constitem44', '最后一段：完整导出终点。']:
            assert expected in compact(text), f'Export truncated: {expected}'
    results.append({'file': name, 'pages': len(pdf.pages), 'selectableCharacters': len(text)})

if args.long:
    pdf = PdfReader(args.long)
    text = compact('\n'.join(page.extract_text() for page in pdf.pages))
    source = Path(args.source).read_text(encoding='utf-8')
    currencies = set(re.findall(r'\$\d[\d,.]*(?:[kKmMbB])?', source))
    missing = currencies - {price for price in currencies if price in text}
    assert not missing, f'{len(missing)} currency amounts were lost or changed'
    tail = re.findall(r'[\u4e00-\u9fff]{6,}', source[-1500:])[-1]
    assert tail in compact('\n'.join(page.extract_text() for page in pdf.pages[-3:])), 'The end of the source was not exported'
    results.append({'file': Path(args.long).name, 'pages': len(pdf.pages), 'currencyValuesChecked': len(currencies), 'endOfDocumentPresent': True})
print(json.dumps({'ok': True, 'pdfs': results}, ensure_ascii=False, indent=2))
