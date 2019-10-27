// custom-ui.js
CoreControls.setWorkerPath('lib/core');
const _ = require('lodash');

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
    for(let i = 0; i < textArray.length; i+=2) {
        const [text, len] = textArray[i]; // ["text", text_length]
        const {x1, y1, x2, y2} = textArray[i + 1];
        result.push({x1, y1, x2, y2, text});        
    }
    return result;
    // Output = [
    //     {
    //          x1, x2, y1, y2, text, len
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
            .map((v, k) => ({y1: k, y2: v.y2, texts: v}))
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
    console.log(sortedArray, closestIndex);
    return closestIndex;
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
    const {x1, y1, x2, y2} = boxCoordinates;
    const baseLineIndex = searchClosestIndex(textMap, e => e.y1, y1);
    const topLineIndex = searchClosestIndex(textMap, e => e.y1, y2);
    return textMap.slice(topLineIndex - 1, baseLineIndex + 1); // Slice doesn't include last index
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
    const {x1: bx1, y1: by1, x2: bx2, y2: by2} = boxCoordinates;
    const filterd = filterRange(textMap, boxCoordinates);
    const result = [];
    filterd.forEach(line => {
        let temp = "";
        line.texts.forEach(word => {
            const {text, x1, x2, y1, y2} = word;
            if (Number(x1) >= bx1 && Number(x2) <= bx2) {
                temp += text;
            }
        });
        result.push(temp);
    });
    return result;
    // Output = ["line1", "line2"];
};

const extractTextFromPage = (doc, pageNumber, action) => {
    // Accepts 0 based page index
    doc.loadPageText(pageNumber, text => {
        const data = [];
        let pageIndex = 0;
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
        const textMap = groupTextsViaYaxis(textZipped);
        action(textMap);
    });
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

    const annotationChangeContainer = document.getElementById('annotation-change');

    const annotManager = docViewer.getAnnotationManager();
    annotManager.on('annotationChanged', (e, annotations, action) => {
        annotationChangeContainer.textContent = action + ' ' + annotations.length;
        if (action === 'add') {
            // console.log('this is a change that added annotations', event);
            const doc = docViewer.getDocument();
            annotations.forEach(annotation => {
                const bottomLeft = doc.getPDFCoordinates(0, annotation.getLeft(), annotation.getBottom());
                const [x1, y1] = [bottomLeft.x, bottomLeft.y];
                // console.log('Annotation x1, y1:', x1, y1);
                const topRight = doc.getPDFCoordinates(0, annotation.getRight(), annotation.getTop());
                const [x2, y2] = [topRight.x, topRight.y];
                // console.log('Annotation x2, y2:', x2, y2);
                extractTextFromPage(doc, 0, textMap => {
                    console.log(textMap);
                    console.log('Box Co-Cordinates ', {x1, y1, x2, y2});
                    console.log(extractTextFromBox(textMap, {x1, y1, x2, y2}));
                });
            });
        } else if (action === 'modify') {
            console.log('this change modified annotations', event);
        } else if (action === 'delete') {
            console.log('there were annotations deleted', event);
        }
        // console.log(annotations);
    });
};

CoreControls.getDefaultPdfBackendType().then(backendType => {
    const licenseKey = 'Insert commercial license key here after purchase';
    const workerTransportPromise = CoreControls.initPDFWorkerTransports(backendType, {}, licenseKey);

    const docViewer = new CoreControls.DocumentViewer();
    const partRetriever = new CoreControls.PartRetrievers.ExternalPdfPartRetriever('../pdfs/Payslips_July_19.pdf');

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
        const doc = docViewer.getDocument();
        // extractTextFromPage(doc, 0);
    });
});