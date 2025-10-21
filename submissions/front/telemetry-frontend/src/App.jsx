import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import { Calendar, Download, RefreshCw, AlertCircle, Fuel, Zap } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const API_BASE = 'http://localhost:5294';
const ALMATY_OFFSET_HOURS = 5;

const MapBounds = ({ bounds }) => {
    const map = useMap();
    useEffect(() => {
        if (bounds && bounds.length === 2) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [bounds, map]);
    return null;
};

const almatyToUnixTimestamp = (dateStr) => {
    const localDate = new Date(dateStr);
    const utcTimestamp = Date.UTC(
        localDate.getFullYear(),
        localDate.getMonth(),
        localDate.getDate(),
        localDate.getHours(),
        localDate.getMinutes(),
        localDate.getSeconds()
    );
    const utcTimestampAdjusted = utcTimestamp - (ALMATY_OFFSET_HOURS * 60 * 60 * 1000);
    return Math.floor(utcTimestampAdjusted / 1000);
};

const unixTimestampToAlmaty = (timestamp) => {
    const utcDate = new Date(timestamp * 1000);
    const almatyDate = new Date(utcDate.getTime() + (ALMATY_OFFSET_HOURS * 60 * 60 * 1000));

    const year = almatyDate.getUTCFullYear();
    const month = String(almatyDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(almatyDate.getUTCDate()).padStart(2, '0');
    const hours = String(almatyDate.getUTCHours()).padStart(2, '0');
    const minutes = String(almatyDate.getUTCMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const formatTimestampForDisplay = (timestamp) => {
    const utcDate = new Date(parseInt(timestamp) * 1000);
    const almatyDate = new Date(utcDate.getTime() + (ALMATY_OFFSET_HOURS * 60 * 60 * 1000));

    const day = String(almatyDate.getUTCDate()).padStart(2, '0');
    const month = String(almatyDate.getUTCMonth() + 1).padStart(2, '0');
    const year = almatyDate.getUTCFullYear();
    const hours = String(almatyDate.getUTCHours()).padStart(2, '0');
    const minutes = String(almatyDate.getUTCMinutes()).padStart(2, '0');
    const seconds = String(almatyDate.getUTCSeconds()).padStart(2, '0');

    return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
};

// Кастомный Tooltip с полной информацией
const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white border-2 border-gray-300 rounded-lg shadow-lg p-3">
                <p className="font-semibold text-gray-800 mb-2">{label}</p>
                {payload.map((entry, index) => (
                    <p key={index} style={{ color: entry.color }} className="text-sm font-medium">
                        {entry.name}: <span className="font-bold">{entry.value}</span>
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

const TelemetryDashboard = () => {
    const [imeis, setImeis] = useState([]);
    const [selectedImei, setSelectedImei] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [telemetryData, setTelemetryData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showIndividualSensors, setShowIndividualSensors] = useState(false);

    useEffect(() => {
        fetchImeis();
        const nowTimestamp = Math.floor(Date.now() / 1000);
        const yesterdayTimestamp = nowTimestamp - (24 * 60 * 60);
        setEndDate(unixTimestampToAlmaty(nowTimestamp));
        setStartDate(unixTimestampToAlmaty(yesterdayTimestamp));
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
            const startTimestamp = almatyToUnixTimestamp(startDate);
            const endTimestamp = almatyToUnixTimestamp(endDate);

            console.log('Запрос данных:', {
                imei: selectedImei,
                startDate,
                endDate,
                startTimestamp,
                endTimestamp,
                startUTC: new Date(startTimestamp * 1000).toISOString(),
                endUTC: new Date(endTimestamp * 1000).toISOString()
            });

            const url = `${API_BASE}/api/telemetry?imei=${selectedImei}&startTimestamp=${startTimestamp}&endTimestamp=${endTimestamp}`;
            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ошибка ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('Получены данные:', data);
            setTelemetryData(data);
        } catch (err) {
            console.error('Ошибка запроса:', err);
            setError('Ошибка загрузки телеметрии: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const formatChartData = (seriesData) => {
        return seriesData.map(point => ({
            time: formatTimestampForDisplay(point.time),
            value: point.value,
            timestamp: point.time
        }));
    };

    const getMapCenter = () => {
        if (!telemetryData?.track || telemetryData.track.length === 0) {
            return [43.2220, 76.8512];
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
                        🚗 Мониторинг Телеметрии InfluxDB
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
                                Начало (Алматы UTC+5)
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
                                Конец (Алматы UTC+5)
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
                                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center justify-center gap-2 transition-colors"
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
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="bg-blue-600 p-3 rounded-lg">
                                        <Calendar className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-600 font-medium">Период</p>
                                        <p className="text-sm font-bold text-gray-800">
                                            {telemetryData.metadata?.rangeDays} дней
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="bg-green-600 p-3 rounded-lg">
                                        <Zap className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-600 font-medium">Записей</p>
                                        <p className="text-sm font-bold text-gray-800">
                                            {telemetryData.metadata?.totalRecords?.toLocaleString()} шт
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="bg-purple-600 p-3 rounded-lg">
                                        <Fuel className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-600 font-medium">Датчики топлива</p>
                                        <p className="text-sm font-bold text-gray-800">
                                            {telemetryData.metadata?.availableFuelSensors?.length || 0} шт
                                            {telemetryData.metadata?.availableFuelSensors?.length > 0 &&
                                                ` (${telemetryData.metadata.availableFuelSensors.map(s => s.replace('fls485_level_', '#')).join(', ')})`
                                            }
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-3 pt-3 border-t border-blue-200">
                                <p className="text-xs text-gray-600">
                                    ⚙️ Агрегация: <span className="font-semibold text-gray-800">{telemetryData.metadata?.aggregationWindow}</span>
                                    {' | '}
                                    📅 С: <span className="font-semibold text-gray-800">{formatTimestampForDisplay(telemetryData.metadata?.startTimestamp)}</span>
                                    {' | '}
                                    📅 По: <span className="font-semibold text-gray-800">{formatTimestampForDisplay(telemetryData.metadata?.endTimestamp)}</span>
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6 mb-6">
                            {/* График скорости */}
                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                                    🏎️ Скорость (км/ч)
                                </h2>
                                {telemetryData.series.speed.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={350}>
                                        <LineChart data={formatChartData(telemetryData.series.speed)}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                            <XAxis
                                                dataKey="time"
                                                angle={-45}
                                                textAnchor="end"
                                                height={100}
                                                fontSize={11}
                                                stroke="#6b7280"
                                            />
                                            <YAxis
                                                label={{ value: 'км/ч', angle: -90, position: 'insideLeft' }}
                                                stroke="#6b7280"
                                            />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                            <Line
                                                type="monotone"
                                                dataKey="value"
                                                stroke="#3b82f6"
                                                name="Скорость"
                                                dot={false}
                                                strokeWidth={2}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-gray-500 text-center py-8">Нет данных о скорости</p>
                                )}
                            </div>

                            {/* График топлива */}
                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                                        ⛽ Уровень топлива (л)
                                    </h2>
                                    {telemetryData.metadata?.availableFuelSensors?.length > 1 && (
                                        <button
                                            onClick={() => setShowIndividualSensors(!showIndividualSensors)}
                                            className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 transition-colors"
                                        >
                                            {showIndividualSensors ? 'Показать сумму' : 'Показать раздельно'}
                                        </button>
                                    )}
                                </div>

                                {!showIndividualSensors && telemetryData.series.fuel_total?.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={350}>
                                        <LineChart data={formatChartData(telemetryData.series.fuel_total)}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                            <XAxis
                                                dataKey="time"
                                                angle={-45}
                                                textAnchor="end"
                                                height={100}
                                                fontSize={11}
                                                stroke="#6b7280"
                                            />
                                            <YAxis
                                                label={{ value: 'литры', angle: -90, position: 'insideLeft' }}
                                                stroke="#6b7280"
                                            />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                            <Line
                                                type="monotone"
                                                dataKey="value"
                                                stroke="#10b981"
                                                name="Общий объем топлива"
                                                dot={false}
                                                strokeWidth={2}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : showIndividualSensors && telemetryData.fuelSensors && Object.keys(telemetryData.fuelSensors).length > 0 ? (
                                    <ResponsiveContainer width="100%" height={350}>
                                        <LineChart>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                            <XAxis
                                                dataKey="time"
                                                angle={-45}
                                                textAnchor="end"
                                                height={100}
                                                fontSize={11}
                                                stroke="#6b7280"
                                                allowDuplicatedCategory={false}
                                            />
                                            <YAxis
                                                label={{ value: 'литры', angle: -90, position: 'insideLeft' }}
                                                stroke="#6b7280"
                                            />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                            {Object.entries(telemetryData.fuelSensors).map(([sensorName, sensorData], index) => {
                                                const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];
                                                const color = colors[index % colors.length];
                                                const sensorNumber = sensorName.replace('fls485_level_', '');
                                                const formattedData = formatChartData(sensorData);

                                                return (
                                                    <Line
                                                        key={sensorName}
                                                        data={formattedData}
                                                        type="monotone"
                                                        dataKey="value"
                                                        stroke={color}
                                                        name={`Датчик #${sensorNumber}`}
                                                        dot={false}
                                                        strokeWidth={2}
                                                    />
                                                );
                                            })}
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-gray-500 text-center py-8">Нет данных о топливе</p>
                                )}
                            </div>

                            {/* График напряжения */}
                            <div className="bg-white rounded-lg shadow-lg p-6">
                                <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                                    🔋 Напряжение питания (В)
                                </h2>
                                {telemetryData.series.main_power_voltage.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={350}>
                                        <LineChart data={formatChartData(telemetryData.series.main_power_voltage)}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                            <XAxis
                                                dataKey="time"
                                                angle={-45}
                                                textAnchor="end"
                                                height={100}
                                                fontSize={11}
                                                stroke="#6b7280"
                                            />
                                            <YAxis
                                                label={{ value: 'Вольты', angle: -90, position: 'insideLeft' }}
                                                stroke="#6b7280"
                                            />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                            <Line
                                                type="monotone"
                                                dataKey="value"
                                                stroke="#f59e0b"
                                                name="Напряжение"
                                                dot={false}
                                                strokeWidth={2}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="text-gray-500 text-center py-8">Нет данных о напряжении</p>
                                )}
                            </div>
                        </div>

                        {/* Карта */}
                        <div className="bg-white rounded-lg shadow-lg p-6">
                            <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                                🗺️ Трек на карте ({telemetryData.track.length.toLocaleString()} точек)
                            </h2>
                            {telemetryData.track.length > 0 ? (
                                <div className="h-96 rounded-lg overflow-hidden border-2 border-gray-300">
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
                                            color="#3b82f6"
                                            weight={3}
                                            opacity={0.7}
                                        />
                                        {telemetryData.track.length > 0 && (
                                            <>
                                                <Marker position={[telemetryData.track[0].lat, telemetryData.track[0].lon]}>
                                                    <Popup>
                                                        <div className="font-medium">
                                                            <strong className="text-green-600">🟢 Начало маршрута</strong><br/>
                                                            {formatTimestampForDisplay(telemetryData.track[0].time)}
                                                        </div>
                                                    </Popup>
                                                </Marker>
                                                <Marker position={[
                                                    telemetryData.track[telemetryData.track.length - 1].lat,
                                                    telemetryData.track[telemetryData.track.length - 1].lon
                                                ]}>
                                                    <Popup>
                                                        <div className="font-medium">
                                                            <strong className="text-red-600">🔴 Конец маршрута</strong><br/>
                                                            {formatTimestampForDisplay(telemetryData.track[telemetryData.track.length - 1].time)}
                                                        </div>
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
                        <p className="text-gray-600 text-lg mb-2">
                            Выберите IMEI и период, затем нажмите "Загрузить данные"
                        </p>
                        <p className="text-gray-500 text-sm">
                            Система автоматически применит оптимальную агрегацию данных
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TelemetryDashboard;