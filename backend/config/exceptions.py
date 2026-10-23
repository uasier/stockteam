from rest_framework.views import exception_handler


def _flatten(data) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, list):
        return "；".join(piece for piece in (_flatten(item) for item in data) if piece)
    if isinstance(data, dict):
        parts = []
        for key, value in data.items():
            text = _flatten(value)
            if not text:
                continue
            if key in {"detail", "non_field_errors", "error"}:
                parts.append(text)
            else:
                parts.append(text if text.startswith(str(key)) else text)
        return "；".join(parts)
    return str(data)


def api_exception_handler(exc, context):
    """把接口错误收成前端可以直接展示的一句中文。"""
    response = exception_handler(exc, context)
    if response is None:
        return None
    message = _flatten(response.data) or "请求没有完成"
    response.data = {"error": message}
    return response
