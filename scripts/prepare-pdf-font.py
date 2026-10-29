"""Generate the bundled regular PDF font from the official Noto Sans SC variable TTF.

Requires fonttools. Usage: python scripts/prepare-pdf-font.py input.ttf output.ttf
Keep the upstream OFL.txt alongside the output.
"""
import argparse
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('input')
parser.add_argument('output')
args = parser.parse_args()
font = TTFont(args.input)
regular = instantiateVariableFont(font, {'wght': 400}, inplace=True, updateFontNames=True)
regular.save(args.output)
