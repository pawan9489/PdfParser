// custom-ui.js
CoreControls.setWorkerPath('lib/core');
const _ = require('lodash');
const uniqueFilename = require('unique-filename');
let globalDocViewer = '';
let current_editing_template = [];
let existing_pdf_templates = [];
let excel_template = [];
let existing_excel_templates = [];
let cached_pages = {};

// PDF - Axis
// X = Left to Right
// Y = Botton to Top

const zipTextWithCoordinates = textArray => {
    // Input - textArray = [
    //    ["text", text_length],
    //    {x1, y2, x2, y2},
    //    ["text", text_length],
    //    {x1, y2, x2, y2}, ......
    // ]
    const result = [];
    for (let i = 0; i < textArray.length; i += 2) {
        const [text, len] = textArray[i]; // ["text", text_length]
        const {
            x1,
            y1,
            x2,
            y2
        } = textArray[i + 1];
        result.push({
            x1,
            y1,
            x2,
            y2,
            text
        });
    }
    return result;
    // Output = [
    //     {
    //          x1, x2, y1, y2, text
    //     }
    // ]
};

const groupTextsViaYaxis = texts => {
    // Input = [
    //     {
    //          x1, x2, y1, y2, text
    //     }
    // ]
    return _.chain(texts)
        .groupBy("y1")
        .map((v, k) => ({
            y1: Number(k),
            y2: Number(v[0].y2),
            texts: v
        }))
        .sortBy(e => e.y1)
        .reverse()
        .value();
    // Output = [
    //     {
    //         y1, 
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
};

const searchClosestIndex = (sortedArray, extracter, x) => {
    // let closest = Infinity;
    let closestDiff = Infinity;
    let closestIndex = 0;
    sortedArray.forEach((e, i) => {
        const currentDiff = Math.abs(x - Number(extracter(e)));
        if (currentDiff < closestDiff) {
            closestDiff = currentDiff;
            // closest = e;
            closestIndex = i;
        }
    });
    return closestIndex;
};

const inBetween = (a, pair) => {
    const [x, y] = pair;
    const [min, max] = [Math.min(x, y), Math.max(x, y)];
    return a >= min && a <= max;
};

const filterRange = (textMap, boxCoordinates) => {
    // boxCoordinates = {x1, y1, x2, y2}
    // (x1, y1) - Bottom Left Corner
    // (x2, y2) - Top Right Corner
    // textMap = [
    //     {
    //         y1, 
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
    // _.indexOf(xs, x, true); -- Binary Search
    // _.indexOf(xs, x); -- Normal Search
    const {
        x1,
        y1,
        x2,
        y2
    } = boxCoordinates;
    // Page = List hanging down
    // Page Top => List Left
    // Page Bottom => List Right
    const topLineIndex = searchClosestIndex(textMap, e => e.y2, y2); // Exclude Top Most
    // Possibilities for TopLineIndex
    // y2.UnWanted.y1 - Box.y2     - y2.Wanted.y1 -- Closer to unwanted line
    // y2.UnWanted.y1 -     Box.y2 - y2.Wanted.y1 -- Closer to wanted line
    // -- closest.y1 inBetween (closest.y2, Box.y2) 
    // ? Don't Pick TopLineIndex : Pick TopLineIndex
    const baseLineIndex = searchClosestIndex(textMap, e => e.y1, y1); // Include Bottom Most
    // Possibilities for BaseLineIndex
    // y2.Wanted.y1 - Box.y1     - y2.UnWanted.y1 -- Closer to wanted line
    // y2.Wanted.y1 -     Box.y1 - y2.UnWanted.y1 -- Closer to unwanted line
    // -- closest.y2 inBetween (Box.y1, closest.y1) 
    // ? Don't Pick BaseLineIndex : Pick BaseLineIndex

    // Slice doesn't include last index
    const topLine = textMap[topLineIndex];
    const bottomLine = textMap[baseLineIndex];
    return textMap.slice(
        inBetween(topLine.y1, [topLine.y2, y2]) ? topLineIndex + 1 : topLineIndex,
        inBetween(bottomLine.y2, [bottomLine.y1, y1]) ? baseLineIndex : baseLineIndex + 1);
    // Output = [
    //     {
    //         y1, // Filtered as  
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
};

const isLeftLeaning = (left, between, right) => {
    // 20 40 80 - Yes, 40 is left leaning
    // 20 60 80 - No, 60 is right leaning
    return (right - between) >= (between - left);
};

const isRightLeaning = (left, between, right) => {
    return !isLeftLeaning(left, between, right);
};

const decideToTakeWord = (wordLeft, wordRight, boxLeft, boxRight) => {
    // Possibilites of Word Overlapping with Box
    /*  1. Word Fully Inside of Box - Take the word
            X1 - W1 - W2 - X2
        2. Left Overlap - Take the word if more that 50% overlap
            W1 - X1 - W2 - X2
        3. Right Overlap - Take the word if more that 50% overlap
            X1 - W1 - X2 - W2
        4. Left Outside - Don't take the word
            W1 - W2 - X1 - X2
        5. Right Outside - Don't take the word
            X1 - X2 - W1 - W2
        6. Box Fully Inside of Word - Take the word if Box Width is more than Half of Word Width 
            W1 - X1 - X2 - W2
    */
    if (boxLeft <= wordLeft && wordRight <= boxRight) {
        return true;
    } else if (wordLeft <= boxLeft && wordRight <= boxRight) {
        return isLeftLeaning(wordLeft, boxLeft, wordRight);
    } else if (boxLeft <= wordLeft && boxRight <= wordRight) {
        return isRightLeaning(wordLeft, boxRight, wordRight);
    } else if (wordRight <= boxLeft || boxRight <= wordLeft) {
        return false;
    } else { // Box Fully Inside of Word
        const wordWidth = wordRight - wordLeft;
        const boxWidth = boxRight - boxLeft;
        return boxWidth * 2 >= wordWidth;
    }
};

const extractTextFromBox = (textMap, boxCoordinates) => {
    // boxCoordinates = {x1, y1, x2, y2}
    // (x1, y1) - Bottom Left Corner
    // (x2, y2) - Top Right Corner
    // textMap = [
    //     {
    //         y1, 
    //         y2,
    //         texts: [
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""},
    //             {text: "text", x1: "", x2: "", y1: "", y2: ""}
    //         ]
    //     }
    // ]
    const {
        x1: bx1,
        y1: by1,
        x2: bx2,
        y2: by2
    } = boxCoordinates;
    const filterd = filterRange(textMap, boxCoordinates);
    const result = [];
    filterd.forEach(line => {
        let temp = "";
        line.texts.forEach(word => {
            const {
                text,
                x1,
                x2,
                y1,
                y2
            } = word;
            if (decideToTakeWord(Number(x1), Number(x2), bx1, bx2)) {
                temp += text;
            }
        });
        if (temp !== "") {
            result.push(temp);
        }
    });
    return result;
    // Output = ["line1", "line2"];
};

const extractTextFromPage = (doc, pageIndex) => {
    // Accepts 0 based page index
    return new Promise((resolve, reject) => {
        doc.loadPageText(pageIndex, text => {
            const data = [];
            const getTextPositionCallback = quads => {
                // 'quads' will contain an array for each character between the start and end indexes
                const first = quads[0];
                const last = quads[quads.length - 1];
                const normalCorordinates = {
                    'x1': first.x1,
                    'x2': last.x2,
                    'y1': first.y4,
                    'y2': first.y1,
                };
                const x1y1 = doc.getPDFCoordinates(pageIndex, normalCorordinates.x1, normalCorordinates.y1);
                const x2y2 = doc.getPDFCoordinates(pageIndex, normalCorordinates.x2, normalCorordinates.y2);
                const pdfCoordinates = {
                    'x1': x1y1.x,
                    'y1': x1y1.y,
                    'x2': x2y2.x,
                    'y2': x2y2.y,
                };
                data.push(pdfCoordinates);
            };
            const refinedData = text // "FirstName LastName↵ReferenceNumber↵"
                .split('\n') // ["FirstName LastName", "ReferenceNumber", ""]
                .map(s => [s, s.length]) // [["FirstName LastName", 18], ["ReferenceNumber", 15], ["", 0]]
                .reduce((acc, x) => { // [["FirstName LastName", 18], ["ReferenceNumber", 34]]
                    if (x[1] === 0) {
                        return acc;
                    } else if (acc.length === 0) {
                        return [x];
                    } else {
                        acc.push([x[0], acc[acc.length - 1][1] + x[1] + 1]);
                        return acc;
                    }
                }, []);
            refinedData.forEach(x => {
                data.push(x);
                doc.getTextPosition(pageIndex, x[1] - x[0].length, x[1], getTextPositionCallback);
            });
            const textZipped = zipTextWithCoordinates(data);
            if (textZipped === undefined || textZipped === null) {
                reject(`Zipping of text co-ordinates failed.`);
            }
            const textMap = groupTextsViaYaxis(textZipped);
            if (textMap === undefined || textMap === null) {
                reject(`TextMap Construction failed.`);
            }
            resolve(textMap);
        });
    });
};

const renderPDF = (backendType, fileName) => {
    const licenseKey = '';
    const workerTransportPromise = CoreControls.initPDFWorkerTransports(backendType, {}, licenseKey);
    const docViewer = globalDocViewer === '' ? new CoreControls.DocumentViewer() : globalDocViewer;
    globalDocViewer = docViewer;
    const partRetriever = new CoreControls.PartRetrievers.ExternalPdfPartRetriever(fileName);
    docViewer.setScrollViewElement(document.getElementById('scroll-view'));
    docViewer.setViewerElement(document.getElementById('viewer'));
    docViewer.loadAsync(partRetriever, {
        type: 'pdf',
        backendType: backendType,
        workerTransportPromise: workerTransportPromise
    });
    docViewer.setOptions({
        enableAnnotations: true
    });
    setupEventHandlers(docViewer);
    docViewer.on('documentLoaded', () => {
        // enable default tool for text and annotation selection
        docViewer.setToolMode(docViewer.getTool('AnnotationEdit'));
        // const doc = docViewer.getDocument();
        // extractTextFromPage(doc, 0);
    });
};

const randomFileName = initial => uniqueFilename('', uniqueFilename('', uniqueFilename('', initial)));

const generateExcel = (sheetsData, options) => {
    // sheetsData = [sheet1Data, sheet2Data, sheet3Data]
    // sheet1Data = // [KeyValuePairs(Rows)]
    // [
    //      {Col1: v11, Col2: v12} // Row
    //      {Col1: v21, Col2: v22} // Row
    // ]
    // options = [
    //      {sheetid: "<SheetName>", header: true} // Sheet 1 Info
    //      {sheetid: "<SheetName>", header: true} // Sheet 2 Info
    // ]
    const fileName = randomFileName('excel');
    alasql(`SELECT * INTO XLSX('${fileName}', ?) FROM ?`, [options, sheetsData]);
};

// setup event handlers for the header
const setupEventHandlers = docViewer => {
    document.getElementById('zoom-in-button').addEventListener('click', () => {
        docViewer.zoomTo(docViewer.getZoom() + 0.25);
    });

    document.getElementById('zoom-out-button').addEventListener('click', () => {
        docViewer.zoomTo(docViewer.getZoom() - 0.25);
    });

    document.getElementById('create-rectangle').addEventListener('click', () => {
        docViewer.setToolMode(docViewer.getTool('AnnotationCreateRectangle'));
    });

    document.getElementById('select').addEventListener('click', () => {
        docViewer.setToolMode(docViewer.getTool('AnnotationEdit'));
    });

    // document.getElementById('upload').addEventListener('change', event => {
    //     const file = event.target.files[0];
    //     console.log(file);
    //     if (file) {
    //         CoreControls.getDefaultPdfBackendType().then(backendType => {
    //             renderPDF(backendType, file);
    //         });
    //     }
    // });

    document.getElementById('upload').addEventListener('change', function () {
        const file = this.files[0];
        console.log(file);
        if (file) {
            CoreControls.getDefaultPdfBackendType().then(backendType => {
                renderPDF(backendType, `../${file.name}`);
            });
        }
    });

    document.getElementById('keyWords').addEventListener('click', () => {
        const modal = document.getElementById("keyWordsModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    document.getElementById('types').addEventListener('click', () => {
        const modal = document.getElementById("typesModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    document.getElementById('structures').addEventListener('click', () => {
        const modal = document.getElementById("structuresModal");
        modal.style.display = "block";
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        };
    });

    // Insert new chip
    $("#keyWords-chip-input").keyup(function (event) {
        const data = this.value;
        if (event.keyCode === 13) {
            //alert(data);
            $('<div class="chip"> ' + data + ' <span class="closebtn" >&times;</span></div>').insertBefore(this);
            $(this).val(null);
        }
    });

    $("#types-chip-input").keyup(function (event) {
        const data = this.value;
        if (event.keyCode === 13) {
            //alert(data);
            $('<div class="chip"> ' + data + ' <span class="closebtn" >&times;</span></div>').insertBefore(this);
            $(this).val(null);
        }
    });

    $("#structures-chip-input").keyup(function (event) {
        const data = this.value;
        if (event.keyCode === 13) {
            //alert(data);
            $('<div class="chip"> ' + data + ' <span class="closebtn" >&times;</span></div>').insertBefore(this);
            $(this).val(null);
        }
    });

    // Remove chip
    $(document).on('click', '.closebtn', function () {
        //alert('test');
        $(this).parent().remove();
    });

    // const annotationChangeContainer = document.getElementById('annotation-change');

    const annotManager = docViewer.getAnnotationManager();
    annotManager.on('annotationChanged', (e, annotations, action) => {
        // annotationChangeContainer.textContent = action + ' ' + annotations.length;
        if (action === 'add') {
            // console.log('this is a change that added annotations', event);
            const doc = docViewer.getDocument();
            annotations.forEach(annotation => {
                const pageIndex = annotation.getPageNumber() - 1;
                const pageCount = doc.getPageCount();
                const bottomLeft = doc.getPDFCoordinates(pageIndex, annotation.getLeft(), annotation.getBottom());
                const [x1, y1] = [bottomLeft.x, bottomLeft.y];
                const topRight = doc.getPDFCoordinates(pageIndex, annotation.getRight(), annotation.getTop());
                const [x2, y2] = [topRight.x, topRight.y];
                const d = [];
                const promises = [];
                for (let i = 0; i < pageCount; i++) {
                    promises.push(extractTextFromPage(doc, i).then(textMap => {
                        // console.log(textMap);
                        // console.log('Box Co-Cordinates ', {x1, y1, x2, y2});
                        d.push(extractTextFromBox(textMap, {
                            x1,
                            y1,
                            x2,
                            y2
                        }));
                    }));
                }
                Promise.all(promises).then(() => {
                    console.log(d, d.length);
                    generateExcel([d.map(arr => ({'NI': arr[0]}))], [{'sheetid': 'NI Info', headers: true}]);
                });
            });
        } else if (action === 'modify') {
            console.log('this change modified annotations', event);
        } else if (action === 'delete') {
            console.log('there were annotations deleted', event);
        }
    });
};

// Main - First Run
CoreControls.getDefaultPdfBackendType().then(backendType => {
    // console.log(backendType); // ems
    // const docViewer = globalDocViewer === '' ? new CoreControls.DocumentViewer() : globalDocViewer;
    // setupEventHandlers(docViewer);
    renderPDF(backendType, '../pdfs/Payslips_July_19.pdf');
});