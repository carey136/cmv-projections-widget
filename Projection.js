define([
	'dojo/_base/declare',
	'dijit/_WidgetBase',
	'dijit/_TemplatedMixin',
    'dijit/_WidgetsInTemplateMixin',
    'dojox/grid/DataGrid',
    'dojo/data/ItemFileWriteStore',
	'dojo/_base/lang',
    'dojo/topic',
    'esri/layers/GraphicsLayer',
    'esri/graphic',
    'esri/renderers/SimpleRenderer',
    'esri/symbols/PictureMarkerSymbol',
    'esri/graphicsUtils',
    'esri/geometry/Point',
    'esri/SpatialReference',
	'esri/geometry/Extent',
	'//cdnjs.cloudflare.com/ajax/libs/proj4js/2.2.2/proj4.js',
    'dojo/text!./Projection/templates/Projection.html',
	'xstyle/css!./Projection/css/Projection.css'
], function (
	declare,
	_WidgetBase,
	_TemplatedMixin,
    _WidgetsInTemplateMixin,
    DataGrid, ItemFileWriteStore, 
	lang, topic,
    GraphicsLayer, Graphic, SimpleRenderer, PictureMarkerSymbol, graphicsUtils, Point, SpatialReference, Extent,
	proj4,
    template
) {
    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
        map: null,
        widgetsInTemplate: true,
        templateString: template,
        baseClass: 'gis_ProjectionDijit',
        // in case this changes some day
        proj4BaseURL: 'http://spatialreference.org/',
        //  options are ESRI, EPSG and SR-ORG
        // See http://spatialreference.org/ for more information
        baseProjection: null,
        proj4Catalog: 'EPSG', // case sensitive!

        postCreate: function () {
            this.inherited(arguments);

            var map = this.map;
            if (!map) {
                console.log('MapInfo error::a map reference is required');
                this.destroy();
                return;
            }
            // spatialreference.org uses the old
            // Proj4js style so we need an alias
            // https://github.com/proj4js/proj4js/issues/23
            window.Proj4js = proj4;

            this.pointSymbol = new PictureMarkerSymbol(require.toUrl('gis/dijit/Projection/images/orange-flag.png'), 32, 32);
            this.pointSymbol.setOffset(12, 14);
            this.pointGraphics = new GraphicsLayer({
                id: 'test_graphics',
                title: 'Test'
            });
            this.pointRenderer = new SimpleRenderer(this.pointSymbol);
            this.pointRenderer.label = 'test';
            this.pointRenderer.description = 'test';
            this.pointGraphics.setRenderer(this.pointRenderer);
            this.map.addLayer(this.pointGraphics);

            this._createProjectionGrid();

            this.own(topic.subscribe('mapClickMode/currentSet', lang.hitch(this, 'setMapClickMode')));

            //initialize when map loaded
            if (map.loaded) {
                this._initialize(map);
            } else {
                map.on('load', lang.hitch(this, '_initialize', map));
            }
        },

        setMapClickMode: function (mode) {
            this.mapClickMode = mode;
        },
        _createProjectionGrid: function () {
            var data = {
                identifier: 'id',
                items: []
            };
            for (var i = 0; i < this.projectionList.length; i++) {
                data.items.push({ 'id': i, 'name': this.projectionList[i].title, 'x': '', 'y': '' });
            }
            this.projectionStore = new ItemFileWriteStore({ data: data });

            var layout = [
               { 'name': 'Name', 'field': 'name', 'width': '100px', 'noresize': 'true', styles: 'bold;text-align: right;' },
               { 'name': 'x', 'field': 'x', 'width': '88px', 'noresize': 'true', 'editable': 'true', styles: 'text-align: right;' },
               { 'name': 'y', 'field': 'y', 'width': '89px', 'noresize': 'true', 'editable': 'true', styles: 'text-align: right;' }
            ];

            this.projectionGrid = new DataGrid({
                cellNavigation: false,
                showHeader: true,
                store: this.projectionStore,
                structure: layout,
                canSort: false,
                singleClickEdit: true,
                autoHeight: true
            }, this.projectionGrid);

            this.projectionGrid.on('ApplyEdit', lang.hitch(this, '_reProjection'));
            this.projectionGrid.startup();
        },

        _initialize: function (map) {
            map.on('click', lang.hitch(this, function (evt) {
                if (this.mapClickMode === 'projection') {
                    this._onClick(evt);
                }
            }));

            var wkid = this.map.spatialReference.wkid;
            if (wkid === 102100) { // ESRI --> EPSG
                wkid = 3857;
            }
            this.baseProjection = this.proj4Catalog + ':' +String(wkid);

            //load projection for each srid 
            for (var i = 0; i < this.projectionList.length; i++) {
                var url = this.proj4BaseURL + 'ref/' + this.proj4Catalog.toLowerCase() + '/' + this.projectionList[i].srid + '/proj4js/';
                require([url]); 
            }
        },

        _onClick: function (evt) {
            this._project(evt.mapPoint);
        },

        _project: function (pnt) {
            this._drawMarker(pnt);

            for (var i = 0; i < this.projectionList.length; i++) {
                var key = this.proj4Catalog + ':' + String(this.projectionList[i].srid);
                var projPnt = proj4(proj4.defs[this.baseProjection], proj4.defs(key)).forward([pnt.x, pnt.y]);

                var item = this.projectionGrid.getItem(i);
                if (proj4.defs(key)) {
                    var precision = (proj4.defs(key)).indexOf('units=m') > -1 ? 2 : 7; // hack: if it ain't metres, it's degrees
                    this.projectionGrid.store.setValue(item, 'x', projPnt[0].toFixed(precision));
                    this.projectionGrid.store.setValue(item, 'y', projPnt[1].toFixed(precision));
                } else {
                    this.projectionGrid.store.setValue(item, 'x', 'Error');
                    this.projectionGrid.store.setValue(item, 'y', 'Error');
                    //item.customStyles += 'background-color:#FFB93F;'
                }
            }
        },

        _reProjection: function (rowIndex) {
            var item = this.projectionGrid.getItem(rowIndex);
            // project back to base map coords
            var key = this.proj4Catalog + ':' + String(this.projectionList[rowIndex].srid);

            if (proj4.defs(key)) {
                var pnt = proj4(proj4.defs(key), proj4.defs[this.baseProjection]).forward([item.x, item.y]);

                // move marker and project from new position
                var point = new Point(pnt[0], pnt[1], new SpatialReference({ wkid: this.map.spatialReference.wkid }));
                this._project(point);
                this.zoomtoMarker(); // maybe turn this off or option
            }
        },

        _drawMarker: function (pnt) {
            var graphic;
            this.pointGraphics.clear();
            graphic = new Graphic(pnt);
            this.pointGraphics.add(graphic);
        },

        toggleMode: function (val) {
            if (val) {
                this.locatePoint();
            } else {
                this.cancelProjection();
            }
        },

        locatePoint: function () {
            this.map.setMapCursor('crosshair');
            topic.publish('mapClickMode/setCurrent', 'projection');
        },

        cancelProjection: function () {
            this.map.setMapCursor('auto');
            topic.publish('mapClickMode/setDefault');
        },

        clearProjections: function () {
            dijit.byId('toggleme').set('checked', false); // will raise the toggleMode event

            for (var i = 0; i < this.projectionList.length; i++) {
                var item = this.projectionGrid.getItem(i);
                this.projectionGrid.store.setValue(item, 'x', '');
                this.projectionGrid.store.setValue(item, 'y', '');
            }
            this.pointGraphics.clear();
        },

        zoomtoMarker: function () {
            var zoomExtent = null;
            if (this.pointGraphics.graphics.length > 0) {
                zoomExtent = this.getPointFeaturesExtent(this.pointGraphics.graphics);
            }
            this.map.setExtent(zoomExtent.expand(1.2));
            // if there is a poinmt in the layer, then go to it. 

            // or read the values entered in current tab, reproject?, and zoom to
        },

        getPointFeaturesExtent: function (pointFeatures) {
            var extent = graphicsUtils.graphicsExtent(pointFeatures);
            if (extent === null && pointFeatures.length > 0) {
                extent = this.getExtentFromPoint(pointFeatures[0]);
            }

            return extent;
        },

        getExtentFromPoint: function (point) {
            var sz = this.pointExtentSize; // hack
            var pt = point.geometry;
            var extent = new Extent({
                'xmin': pt.x - sz,
                'ymin': pt.y - sz,
                'xmax': pt.x + sz,
                'ymax': pt.y + sz,
                'spatialReference': {
                    wkid: this.map.spatialReference.wkid
                }
            });
            return extent;
        }
    });
});
