import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import { Calendar, Download, RefreshCw, AlertCircle } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const API_BASE = 'http://localhost:5294';

const MapBounds = ({ bounds }) => {
    const map = useMap();

    useEffect(() => {
        if (bounds && bounds.length === 2) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [bounds, map]);

    return null;
};

const ALMATY_OFFSET = 5 * 60;

const formatDateForAPI = (date) => {
    return date.toISOString();
};

const formatDateForInput = (date) => {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000) + (ALMATY_OFFSET * 60 * 1000));
    return localDate.toISOString().slice(0, 16);
};

const parseInputDate = (dateStr) => {
    const date = new Date(dateStr);
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() + (offset * 60 * 1000) - (ALMATY_OFFSET * 60 * 1000));
};

const TelemetryDashboard = () => {
    const [imeis, setImeis] = useState([]);
    const [selectedImei, setSelectedImei] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [telemetryData, setTelemetryData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchImeis();

        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        setEndDate(formatDateForInput(now));
        setStartDate(formatDateForInput(yesterday));
    }, []);

    const fetchImeis = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/imeis`);
            const data = await response.json();
            setImeis(data.imeis || []);
            if (data.imeis && data.imeis.length > 0) {
                setSelectedImei(data.imeis[0]);
            }
        } catch (err) {
            setError('Ошибка загрузки списка IMEI: ' + err.message);
        }
    };

    const fetchTelemetry = async () => {
        if (!selectedImei || !startDate || !endDate) {
            setError('Пожалуйста, заполните все поля');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const start = parseInputDate(startDate);
            const end = parseInputDate(endDate);

            const response = await fetch(
                `${API_BASE}/api/telemetry?imei=${selectedImei}&start=${formatDateForAPI(start)}&end=${formatDateForAPI(end)}`
            );

            if (!response.ok) {
                throw new Error('Ошибка получения данных');
            }

            const data = await response.json();
            setTelemetryData(data);
        } catch (err) {
            setError('Ошибка загрузки телеметрии: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const formatChartData = (seriesData) => {
        return seriesData.map(point => ({
            time: new Date(point.time).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }),
            value: point.value
        }));
    };

    const getMapCenter = () => {
        if (!telemetryData?.track || telemetryData.track.length === 0) {
            return [51.1694, 71.4491];
        }
        const firstPoint = telemetryData.track[0];
        return [firstPoint.lat, firstPoint.lon];
    };

    const getMapBounds = () => {
        if (!telemetryData?.track || telemetryData.track.length === 0) return null;

        const lats = telemetryData.track.map(p => p.lat);
        const lons = telemetryData.track.map(p => p.lon);

        return [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)]
        ];
    };

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-7xl mx-auto">
                <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                    <h1 className="text-3xl font-bold text-gray-800 mb-6">
                        Мониторинг Телеметрии InfluxDB
                    </h1>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                IMEI
                            </label>
                            <select
                                value={selectedImei}
                                onChange={(e) => setSelectedImei(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {imeis.map(imei => (
                                    <option key={imei} value={imei}>{imei}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Начало (Алматы)
                            </label>
                            <input
                                type="datetime-local"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Конец (Алматы)
                            </label>
                            <input
                                type="datetime-local"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="flex items-end">
                            <button
                                onClick={fetchTelemetry}
                                disabled={loading}
                                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Загрузка...
                                    </>
                                ) : (
                                    <>
                                        <Download className="w-4 h-4" />
                                        Загрузить данные
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start gap-2">
                            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-red-700">{error}</p>
                        </div>
                    )}
                </div>

                {telemetryData && (
                    <div>
                        <div className="grid grid-cols-1 gap-6 mb-6">
                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h2 className="text-xl font-semibold text-gray-800 mb-4">
                                    Скорость (км/ч)
                                </h2>
                                {telemetryData.series.speed.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <LineChart data={formatChartData(telemetryData.series.speed)}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" angle={-45} textAnchor="end" height={80} />
                                            <YAxis label={{ value: 'км/ч', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip />
                                            <Legend />
                                            <Line type="monotone" dataKey="value" stroke="#3b82f6" name="Скорость" dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-gray-500 text-center py-8">Нет данных</p>
                                )}
                            </div>

                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h2 className="text-xl font-semibold text-gray-800 mb-4">
                                    Уровень топлива FLS485 (л)
                                </h2>
                                {telemetryData.series.fls485_level_2.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <LineChart data={formatChartData(telemetryData.series.fls485_level_2)}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" angle={-45} textAnchor="end" height={80} />
                                            <YAxis label={{ value: 'литры', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip />
                                            <Legend />
                                            <Line type="monotone" dataKey="value" stroke="#10b981" name="Топливо" dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-gray-500 text-center py-8">Нет данных</p>
                                )}
                            </div>

                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h2 className="text-xl font-semibold text-gray-800 mb-4">
                                    Напряжение питания (В)
                                </h2>
                                {telemetryData.series.main_power_voltage.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <LineChart data={formatChartData(telemetryData.series.main_power_voltage)}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" angle={-45} textAnchor="end" height={80} />
                                            <YAxis label={{ value: 'Вольты', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip />
                                            <Legend />
                                            <Line type="monotone" dataKey="value" stroke="#f59e0b" name="Напряжение" dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-gray-500 text-center py-8">Нет данных</p>
                                )}
                            </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-lg p-6">
                            <h2 className="text-xl font-semibold text-gray-800 mb-4">
                                Трек на карте ({telemetryData.track.length} точек)
                            </h2>
                            {telemetryData.track.length > 0 ? (
                                <div className="h-96 rounded-lg overflow-hidden border border-gray-300">
                                    <MapContainer
                                        center={getMapCenter()}
                                        zoom={13}
                                        style={{ height: '100vh', width: '100%' }}
                                        scrollWheelZoom={true}
                                    >
                                        <TileLayer
                                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                        />
                                        <MapBounds bounds={getMapBounds()} />
                                        <Polyline
                                            positions={telemetryData.track.map(p => [p.lat, p.lon])}
                                            color="blue"
                                            weight={3}
                                            opacity={0.7}
                                        />
                                        {telemetryData.track.length > 0 && (
                                            <>
                                                <Marker position={[telemetryData.track[0].lat, telemetryData.track[0].lon]}>
                                                    <Popup>
                                                        <strong>Начало маршрута</strong><br/>
                                                        {new Date(telemetryData.track[0].time).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}
                                                    </Popup>
                                                </Marker>
                                                <Marker position={[
                                                    telemetryData.track[telemetryData.track.length - 1].lat,
                                                    telemetryData.track[telemetryData.track.length - 1].lon
                                                ]}>
                                                    <Popup>
                                                        <strong>Конец маршрута</strong><br/>
                                                        {new Date(telemetryData.track[telemetryData.track.length - 1].time).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}
                                                    </Popup>
                                                </Marker>
                                            </>
                                        )}
                                    </MapContainer>
                                </div>
                            ) : (
                                <p className="text-gray-500 text-center py-8">Нет данных GPS</p>
                            )}
                        </div>
                    </div>
                )}

                {!telemetryData && !loading && !error && (
                    <div className="bg-white rounded-lg shadow-lg p-12 text-center">
                        <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-600 text-lg">
                            Выберите IMEI и период, затем нажмите "Загрузить данные"
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TelemetryDashboard;