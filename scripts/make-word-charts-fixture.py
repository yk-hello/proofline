"""Build test-fixtures/word-charts.docx: a Word document with native charts
(clustered column, stacked bar, line, pie, doughnut) whose data lives in chart caches.
Usage: python3 scripts/make-word-charts-fixture.py"""
import sys
from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml import parse_xml
from pptx.chart.data import CategoryChartData
from pptx.chart.xmlwriter import ChartXmlWriter
from pptx.enum.chart import XL_CHART_TYPE

out = sys.argv[1] if len(sys.argv) > 1 else 'test-fixtures/word-charts.docx'
doc = Document()
doc.add_heading('季度报告', 1)
doc.add_paragraph('下面是本季度的销售情况。')

def add_chart(index, kind, categories, series, title):
    data = CategoryChartData(); data.categories = categories
    for name, values in series: data.add_series(name, values)
    xml = ChartXmlWriter(kind, data).xml
    if title:
        xml = xml.replace('<c:chart>', '<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>%s</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>' % title, 1)
    part = Part(PackURI('/word/charts/chart%d.xml' % index), 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml', xml.encode('utf-8'), doc.part.package)
    rid = doc.part.relate_to(part, RT.CHART)
    paragraph = doc.add_paragraph()
    run = paragraph.add_run()
    run._r.append(parse_xml(
        '<w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<wp:inline><wp:extent cx="5486400" cy="3200400"/><wp:docPr id="%d" name="Chart %d"/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="%s"/></a:graphicData></a:graphic></wp:inline></w:drawing>' % (index, index, rid)))

add_chart(1, XL_CHART_TYPE.COLUMN_CLUSTERED, ['Q1', 'Q2', 'Q3', 'Q4'], [('线上', (80, 95, 120, 110)), ('门店', (40, 55, 60, 72))], '季度销售额')
doc.add_paragraph('各部门人数如下，研发最多。')
add_chart(2, XL_CHART_TYPE.BAR_STACKED, ['研发', '销售', '运营'], [('正式', (30, 20, 12)), ('外包', (12, 10, 6))], '部门人数')
add_chart(3, XL_CHART_TYPE.LINE_MARKERS, ['1月', '2月', '3月'], [('转化率', (1.2, 1.5, 1.4))], None)
add_chart(4, XL_CHART_TYPE.PIE, ['线上', '门店', '分销'], [('占比', (45, 30, 25))], '渠道占比')
add_chart(5, XL_CHART_TYPE.DOUGHNUT, ['新客', '老客'], [('客户', (35, 65))], '客户构成')
doc.add_paragraph('报告结束。')
doc.save(out)
print(out)
