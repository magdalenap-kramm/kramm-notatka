#!/bin/sh
# przed commitem zmian w aplikacji: nowy numer wersji (telefony same się odświeżą)
v=$(date +%Y%m%d%H%M); echo $v > wersja.txt; sed -i "s/const WERSJA = '[0-9]*';/const WERSJA = '$v';/" index.html
