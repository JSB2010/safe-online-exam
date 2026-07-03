package org.kentdenver.sebcanvas.service;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
public class SebConfigKeyService {

    private static final String CONFIG_KEY_HASH_HEADER = "X-SafeExamBrowser-ConfigKeyHash";
    private static final Comparator<String> SEB_KEY_COMPARATOR = (left, right) -> {
        int caseInsensitive = left.compareToIgnoreCase(right);
        return caseInsensitive != 0 ? caseInsensitive : left.compareTo(right);
    };

    public String computeConfigKey(byte[] plistBytes) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            factory.setExpandEntityReferences(false);
            factory.setNamespaceAware(false);

            Document document = factory.newDocumentBuilder()
                    .parse(new ByteArrayInputStream(plistBytes));
            Element rootDict = findRootDict(document);
            @SuppressWarnings("unchecked")
            Map<String, Object> canonical = (Map<String, Object>) parseValue(rootDict);
            removeNonHashedEntries(canonical);

            return sha256Hex(toSebJson(canonical));
        } catch (Exception e) {
            throw new IllegalStateException("Unable to compute SEB Config Key", e);
        }
    }

    public boolean validateConfigKeyHashForUrl(String providedHash, String url, String storedConfigKey) {
        if (providedHash == null || providedHash.isBlank()
                || url == null || url.isBlank()
                || storedConfigKey == null || storedConfigKey.isBlank()) {
            return false;
        }

        String expectedHash = hashForUrl(stripFragment(url), storedConfigKey);
        return constantTimeEquals(expectedHash, providedHash);
    }

    public boolean validateConfigKeyHash(HttpServletRequest request, String storedConfigKey) {
        if (request == null || storedConfigKey == null || storedConfigKey.isBlank()) {
            return false;
        }

        String providedHash = request.getHeader(CONFIG_KEY_HASH_HEADER);
        return validateConfigKeyHashForUrl(providedHash, getRequestUrlWithoutFragment(request), storedConfigKey);
    }

    public String hashForUrl(String url, String configKey) {
        return sha256Hex(stripFragment(url) + configKey);
    }

    private Element findRootDict(Document document) {
        Element documentElement = document.getDocumentElement();
        if ("dict".equals(documentElement.getTagName())) {
            return documentElement;
        }

        if ("plist".equals(documentElement.getTagName())) {
            for (Element child : childElements(documentElement)) {
                if ("dict".equals(child.getTagName())) {
                    return child;
                }
            }
        }

        throw new IllegalArgumentException("SEB configuration is not a plist dictionary");
    }

    private Object parseValue(Element element) {
        return switch (element.getTagName()) {
            case "dict" -> parseDict(element);
            case "array" -> parseArray(element);
            case "string" -> element.getTextContent().trim();
            case "date" -> element.getTextContent();
            case "integer" -> Long.parseLong(element.getTextContent().trim());
            case "real" -> new BigDecimal(element.getTextContent().trim()).stripTrailingZeros();
            case "true" -> Boolean.TRUE;
            case "false" -> Boolean.FALSE;
            case "data" -> normalizeBase64(element.getTextContent());
            default -> element.getTextContent();
        };
    }

    private Map<String, Object> parseDict(Element dict) {
        Map<String, Object> values = new TreeMap<>(SEB_KEY_COMPARATOR);
        List<Element> children = childElements(dict);
        for (int i = 0; i < children.size(); i++) {
            Element keyElement = children.get(i);
            if (!"key".equals(keyElement.getTagName()) || i + 1 >= children.size()) {
                continue;
            }

            Element valueElement = children.get(++i);
            values.put(keyElement.getTextContent(), parseValue(valueElement));
        }
        return values;
    }

    private List<Object> parseArray(Element array) {
        List<Object> values = new ArrayList<>();
        for (Element child : childElements(array)) {
            values.add(parseValue(child));
        }
        return values;
    }

    private void removeNonHashedEntries(Map<String, Object> values) {
        values.remove("originatorVersion");
        values.entrySet().removeIf(entry -> isEmptyDictAfterPruning(entry.getValue()));
    }

    @SuppressWarnings("unchecked")
    private boolean isEmptyDictAfterPruning(Object value) {
        if (value instanceof Map<?, ?> map) {
            removeNonHashedEntries((Map<String, Object>) map);
            return map.isEmpty();
        }

        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> mapItem) {
                    removeNonHashedEntries((Map<String, Object>) mapItem);
                }
            }
        }

        return false;
    }

    private String toSebJson(Object value) {
        if (value instanceof Map<?, ?> map) {
            StringBuilder json = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    json.append(',');
                }
                json.append(toSebJsonString(String.valueOf(entry.getKey())));
                json.append(':');
                json.append(toSebJson(entry.getValue()));
                first = false;
            }
            return json.append('}').toString();
        }

        if (value instanceof List<?> list) {
            StringBuilder json = new StringBuilder("[");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) {
                    json.append(',');
                }
                json.append(toSebJson(list.get(i)));
            }
            return json.append(']').toString();
        }

        if (value instanceof String stringValue) {
            return toSebJsonString(stringValue);
        }

        if (value instanceof BigDecimal decimal) {
            return decimal.toPlainString();
        }

        return String.valueOf(value);
    }

    private String toSebJsonString(String value) {
        return "\"" + value + "\"";
    }

    private List<Element> childElements(Element parent) {
        List<Element> elements = new ArrayList<>();
        NodeList nodes = parent.getChildNodes();
        for (int i = 0; i < nodes.getLength(); i++) {
            Node node = nodes.item(i);
            if (node instanceof Element element) {
                elements.add(element);
            }
        }
        return elements;
    }

    private String normalizeBase64(String value) {
        byte[] decoded = Base64.getMimeDecoder().decode(value.replaceAll("\\s+", ""));
        return Base64.getEncoder().encodeToString(decoded);
    }

    private String getRequestUrlWithoutFragment(HttpServletRequest request) {
        StringBuilder url = new StringBuilder();
        url.append(request.getScheme()).append("://")
                .append(request.getServerName());

        if (request.getServerPort() != 80 && request.getServerPort() != 443) {
            url.append(":").append(request.getServerPort());
        }

        url.append(request.getRequestURI());
        if (request.getQueryString() != null) {
            url.append("?").append(request.getQueryString());
        }
        return url.toString();
    }

    private String stripFragment(String url) {
        int fragmentIndex = url.indexOf('#');
        return fragmentIndex >= 0 ? url.substring(0, fragmentIndex) : url;
    }

    private String sha256Hex(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hash);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to compute SHA-256", e);
        }
    }

    private boolean constantTimeEquals(String expected, String provided) {
        return MessageDigest.isEqual(
                expected.toLowerCase().getBytes(StandardCharsets.UTF_8),
                provided.toLowerCase().getBytes(StandardCharsets.UTF_8));
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }
}
