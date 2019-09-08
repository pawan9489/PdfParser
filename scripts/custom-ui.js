// custom-ui.js
CoreControls.setWorkerPath('lib/core');

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

    // docViewer.displayPageLocation(0, 100, 100);

    const annotationChangeContainer = document.getElementById('annotation-change');

    const annotManager = docViewer.getAnnotationManager();
    annotManager.on('annotationChanged', (e, annotations, action) => {
        annotationChangeContainer.textContent = action + ' ' + annotations.length;
        if (action === 'add') {
            console.log('this is a change that added annotations', event);
        } else if (action === 'modify') {
            console.log('this change modified annotations', event);
        } else if (action === 'delete') {
            console.log('there were annotations deleted', event);
        }
        console.log(annotations);
        const doc = docViewer.getDocument();
        annotations.forEach(annotation => {
            console.log('Annotation x1, y1:', doc.getPDFCoordinates(0, annotation.getLeft(), annotation.getBottom()));
            console.log('Annotation x2, y2:', doc.getPDFCoordinates(0, annotation.getRight(), annotation.getTop()));
        });
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
        // Accepts 0 based page index
        doc.loadPageText(0, text => {
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
            console.log(data);
        });
    });
});